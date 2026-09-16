#include "root.h"

#ifndef LAZY_LOAD_SQLITE
#define LAZY_LOAD_SQLITE 0
#endif

#if LAZY_LOAD_SQLITE
#include "lazy_sqlite3.h"
#else
#include "sqlite3_local.h"
static inline int lazyLoadSQLite(WTF::String* = nullptr) { return 0; }
#endif

#include "DurableObjectStorage.h"
#include "DurableObject.h"

#include "BunClientData.h"
#include "ErrorCode.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "JSDOMExceptionHandling.h"
#include "NodeValidator.h"
#include "PathInlines.h"
#include "SerializedScriptValue.h"
#include "ZigGlobalObject.h"
#include "sqlite3_error_codes.h"

#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/DateInstance.h>
#include <JavaScriptCore/MicrotaskQueue.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayBufferViewInlines.h>
#include <JavaScriptCore/JSArrayIterator.h>
#include <JavaScriptCore/JSBigInt.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/TypedArrayInlines.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/unicode/UTF8Conversion.h>

extern "C" void Bun__initializeSQLite();
// 0, or an errno.
extern "C" int Bun__DurableObject__makeDirectory(const uint8_t* path, size_t length);
extern "C" void Bun__DurableObject__removeFile(const uint8_t* path, size_t length);

namespace Bun {
using namespace JSC;

static constexpr int metaAlarm = 1;
static constexpr size_t maxKeyBytes = 2048;
static constexpr unsigned maxCachedStatements = 32;

// ─── SQLite plumbing ─────────────────────────────────────────────────────────

static bool loadSQLite(String& error)
{
    if (lazyLoadSQLite(&error) < 0)
        return false;
    Bun__initializeSQLite();
    return true;
}

static String sqliteMessage(sqlite3* db)
{
    const char* message = sqlite3_errmsg(db);
    return String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const unsigned char*>(message), strlen(message) });
}

class TextBinding {
public:
    explicit TextBinding(const String& string)
    {
        if (string.is8Bit() && string.containsOnlyASCII()) {
            m_span = string.span8();
            return;
        }
        m_utf8 = string.utf8();
        m_span = { reinterpret_cast<const Latin1Character*>(m_utf8.data()), m_utf8.length() };
    }
    int bind(sqlite3_stmt* statement, int index) const
    {
        return sqlite3_bind_text(statement, index, reinterpret_cast<const char*>(m_span.data()), static_cast<int>(m_span.size()), SQLITE_STATIC);
    }
    size_t byteLength() const { return m_span.size(); }

private:
    std::span<const Latin1Character> m_span;
    CString m_utf8;
};

class StatementReset {
public:
    explicit StatementReset(sqlite3_stmt* statement)
        : m_statement(statement)
    {
    }
    ~StatementReset()
    {
        sqlite3_reset(m_statement);
        sqlite3_clear_bindings(m_statement);
    }

private:
    sqlite3_stmt* m_statement;
};

static String columnText(sqlite3_stmt* statement, int column)
{
    const unsigned char* text = sqlite3_column_text(statement, column);
    size_t length = static_cast<size_t>(sqlite3_column_bytes(statement, column));
    if (!text || !length)
        return emptyString();
    return String::fromUTF8ReplacingInvalidSequences({ text, length });
}

static bool hasReservedPrefix(const char* name)
{
    return name && (name[0] == '_') && (name[1] == 'c' || name[1] == 'C') && (name[2] == 'f' || name[2] == 'F') && name[3] == '_';
}

static bool pragmaIsAllowed(const char* name)
{
    static constexpr ASCIILiteral allowed[] = {
        "table_info"_s,
        "table_xinfo"_s,
        "table_list"_s,
        "index_list"_s,
        "index_info"_s,
        "index_xinfo"_s,
        "foreign_key_list"_s,
        "foreign_key_check"_s,
        "foreign_keys"_s,
        "defer_foreign_keys"_s,
        "case_sensitive_like"_s,
        "ignore_check_constraints"_s,
        "legacy_alter_table"_s,
        "recursive_triggers"_s,
        "reverse_unordered_selects"_s,
        "quick_check"_s,
        "integrity_check"_s,
        "optimize"_s,
        "data_version"_s,
        "page_count"_s,
        "page_size"_s,
        "freelist_count"_s,
        "function_list"_s,
        "collation_list"_s,
        "compile_options"_s,
    };
    for (auto literal : allowed) {
        if (equalIgnoringASCIICase(StringView::fromLatin1(name), literal))
            return true;
    }
    return false;
}

int DurableObjectDatabase::authorize(void* userData, int action, const char* first, const char* second, const char*, const char*)
{
    auto* database = static_cast<DurableObjectDatabase*>(userData);
    if (!database->m_restricted)
        return SQLITE_OK;
    switch (action) {
    case SQLITE_TRANSACTION:
    case SQLITE_SAVEPOINT:
    case SQLITE_ATTACH:
    case SQLITE_DETACH:
        return SQLITE_DENY;
    case SQLITE_PRAGMA:
        return pragmaIsAllowed(first) ? SQLITE_OK : SQLITE_DENY;
    case SQLITE_ALTER_TABLE:
        return hasReservedPrefix(second) ? SQLITE_DENY : SQLITE_OK;
    case SQLITE_FUNCTION:
    case SQLITE_SELECT:
    case SQLITE_RECURSIVE:
    case SQLITE_ANALYZE:
    case SQLITE_REINDEX:
        return SQLITE_OK;
    default:
        return hasReservedPrefix(first) || hasReservedPrefix(second) ? SQLITE_DENY : SQLITE_OK;
    }
}

bool DurableObjectDatabase::exec(const char* sql)
{
    return sqlite3_exec(m_db, sql, nullptr, nullptr, nullptr) == SQLITE_OK;
}

sqlite3_stmt* DurableObjectDatabase::statement(sqlite3_stmt*& slot, const char* sql)
{
    if (!slot)
        sqlite3_prepare_v3(m_db, sql, -1, SQLITE_PREPARE_PERSISTENT, &slot, nullptr);
    return slot;
}

String DurableObjectDatabase::lastError() const { return sqliteMessage(m_db); }
int DurableObjectDatabase::lastErrorCode() const { return sqlite3_extended_errcode(m_db); }

String durableObjectDatabasePath(const String& directory, const String& hex)
{
    return makeString(directory, PLATFORM_SEP_s, hex.left(2), PLATFORM_SEP_s, hex, ".sqlite"_s);
}

static bool makeDirectory(const String& path, String& error)
{
    CString utf8 = path.utf8();
    int result = Bun__DurableObject__makeDirectory(reinterpret_cast<const uint8_t*>(utf8.data()), utf8.length());
    if (!result)
        return true;
    error = makeString("Could not create the Durable Object storage directory "_s, path, ": "_s, String::fromUTF8(strerror(result)));
    return false;
}

std::unique_ptr<DurableObjectDatabase> DurableObjectDatabase::open(const String& path, String& error)
{
    if (!loadSQLite(error))
        return nullptr;
    if (!path.isNull()) {
        size_t separator = path.reverseFind(PLATFORM_SEP);
        if (separator != notFound && !makeDirectory(path.left(separator), error))
            return nullptr;
    }
    auto database = std::unique_ptr<DurableObjectDatabase>(new DurableObjectDatabase());
    database->m_path = path;
    CString filename = path.isNull() ? CString(":memory:") : path.utf8();
    int result = sqlite3_open_v2(filename.data(), &database->m_db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_NOMUTEX | SQLITE_OPEN_EXRESCODE, nullptr);
    if (result != SQLITE_OK) {
        error = database->m_db ? sqliteMessage(database->m_db) : String::fromUTF8(sqlite3_errstr(result));
        return nullptr;
    }
    sqlite3_db_config(database->m_db, SQLITE_DBCONFIG_DEFENSIVE, 1, nullptr);
    bool ok = true;
    if (!path.isNull()) {
        // The namespace holds the directory (DurableObjectAlarmIndex), so no other connection opens this file.
        ok = database->exec("PRAGMA locking_mode = EXCLUSIVE") && database->exec("PRAGMA journal_mode = WAL") && database->exec("PRAGMA synchronous = NORMAL");
    }
    ok = ok && database->exec("PRAGMA foreign_keys = ON")
        && database->exec("CREATE TABLE IF NOT EXISTS _cf_KV (key TEXT PRIMARY KEY, value BLOB) WITHOUT ROWID")
        && database->exec("CREATE TABLE IF NOT EXISTS _cf_METADATA (key INTEGER PRIMARY KEY, value BLOB)");
    if (!ok) {
        error = sqliteMessage(database->m_db);
        return nullptr;
    }
    sqlite3_set_authorizer(database->m_db, authorize, database.get());
    return database;
}

DurableObjectDatabase::~DurableObjectDatabase()
{
    close(false);
}

void DurableObjectDatabase::close(bool removeIfEmpty)
{
    if (!m_db)
        return;
    rollback();
    bool remove = removeIfEmpty && !m_path.isNull() && isEmpty();
    for (sqlite3_stmt** slot : { &m_begin, &m_commit, &m_rollback, &m_kvGet, &m_kvPut, &m_kvDelete, &m_metaGet, &m_metaPut, &m_metaDelete }) {
        if (*slot)
            sqlite3_finalize(*slot);
        *slot = nullptr;
    }
    for (auto& entry : m_cache)
        sqlite3_finalize(entry.value);
    m_cache.clear();
    // A cursor that script still holds finalizes its statement when it is collected.
    sqlite3_close_v2(m_db);
    m_db = nullptr;
    if (remove) {
        for (auto suffix : { ""_s, "-wal"_s, "-shm"_s, "-journal"_s }) {
            CString file = makeString(m_path, suffix).utf8();
            Bun__DurableObject__removeFile(reinterpret_cast<const uint8_t*>(file.data()), file.length());
        }
    }
}

bool DurableObjectDatabase::write()
{
    if (m_inTransaction)
        return true;
    sqlite3_stmt* begin = statement(m_begin, "BEGIN");
    if (!begin || sqlite3_step(begin) != SQLITE_DONE) {
        if (begin)
            sqlite3_reset(begin);
        return false;
    }
    sqlite3_reset(begin);
    m_inTransaction = true;
    return true;
}

bool DurableObjectDatabase::flush()
{
    if (!m_inTransaction || m_depth)
        return true;
    m_inTransaction = false;
    sqlite3_stmt* commit = statement(m_commit, "COMMIT");
    bool ok = commit && sqlite3_step(commit) == SQLITE_DONE;
    if (commit)
        sqlite3_reset(commit);
    if (!ok && !sqlite3_get_autocommit(m_db))
        exec("ROLLBACK");
    return ok;
}

void DurableObjectDatabase::rollback()
{
    m_depth = 0;
    if (!m_inTransaction)
        return;
    m_inTransaction = false;
    if (!sqlite3_get_autocommit(m_db))
        exec("ROLLBACK");
}

bool DurableObjectDatabase::beginScope()
{
    if (!write())
        return false;
    if (!exec(makeString("SAVEPOINT _cf_scope"_s, m_depth).utf8().data()))
        return false;
    m_depth++;
    return true;
}

bool DurableObjectDatabase::endScope(bool commit)
{
    if (!m_depth)
        return true;
    m_depth--;
    bool ok = true;
    if (!commit)
        ok = exec(makeString("ROLLBACK TO _cf_scope"_s, m_depth).utf8().data());
    return exec(makeString("RELEASE _cf_scope"_s, m_depth).utf8().data()) && ok;
}

DurableObjectDatabase::Lookup DurableObjectDatabase::kvGet(const String& key, Vector<uint8_t>& value)
{
    sqlite3_stmt* get = statement(m_kvGet, "SELECT value FROM _cf_KV WHERE key = ?");
    if (!get)
        return Lookup::Failed;
    StatementReset reset(get);
    TextBinding text(key);
    text.bind(get, 1);
    int result = sqlite3_step(get);
    if (result == SQLITE_DONE)
        return Lookup::Missing;
    if (result != SQLITE_ROW)
        return Lookup::Failed;
    const void* blob = sqlite3_column_blob(get, 0);
    size_t length = static_cast<size_t>(sqlite3_column_bytes(get, 0));
    value.append(std::span { static_cast<const uint8_t*>(blob), length });
    return Lookup::Found;
}

bool DurableObjectDatabase::kvPut(const String& key, std::span<const uint8_t> value)
{
    sqlite3_stmt* put = statement(m_kvPut, "INSERT INTO _cf_KV (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
    if (!put)
        return false;
    StatementReset reset(put);
    TextBinding text(key);
    text.bind(put, 1);
    sqlite3_bind_blob64(put, 2, value.data(), value.size(), SQLITE_STATIC);
    return sqlite3_step(put) == SQLITE_DONE;
}

bool DurableObjectDatabase::kvDelete(const String& key, bool& existed)
{
    sqlite3_stmt* del = statement(m_kvDelete, "DELETE FROM _cf_KV WHERE key = ?");
    if (!del)
        return false;
    StatementReset reset(del);
    TextBinding text(key);
    text.bind(del, 1);
    if (sqlite3_step(del) != SQLITE_DONE)
        return false;
    existed = sqlite3_changes(m_db) > 0;
    return true;
}

// The smallest string that sorts after every string with this prefix (keys sort by their UTF-8
// bytes, which is code point order); null when there is none.
static String prefixSuccessor(const String& prefix)
{
    Vector<char32_t> points;
    for (auto point : StringView(prefix).codePoints())
        points.append(point);
    while (!points.isEmpty()) {
        char32_t last = points.last();
        if (last >= 0x10FFFF) {
            points.removeLast();
            continue;
        }
        last++;
        if (last >= 0xD800 && last <= 0xDFFF)
            last = 0xE000;
        points.last() = last;
        StringBuilder builder;
        for (auto point : points)
            builder.append(point);
        return builder.toString();
    }
    return String();
}

bool DurableObjectDatabase::kvList(const ListOptions& options, const Function<bool(String&&, std::span<const uint8_t>)>& row)
{
    StringBuilder sql;
    sql.append("SELECT key, value FROM _cf_KV"_s);
    Vector<String, 5> bound;
    auto where = [&](ASCIILiteral comparison, const String& value) {
        sql.append(bound.isEmpty() ? " WHERE "_s : " AND "_s, comparison);
        bound.append(value);
    };
    if (!options.start.isNull())
        where("key >= ?"_s, options.start);
    if (!options.startAfter.isNull())
        where("key > ?"_s, options.startAfter);
    if (!options.end.isNull())
        where("key < ?"_s, options.end);
    if (!options.prefix.isEmpty()) {
        where("key >= ?"_s, options.prefix);
        String after = prefixSuccessor(options.prefix);
        if (!after.isNull())
            where("key < ?"_s, after);
    }
    sql.append(options.reverse ? " ORDER BY key DESC"_s : " ORDER BY key"_s);
    if (options.limit >= 0)
        sql.append(" LIMIT "_s, options.limit);

    String text = sql.toString();
    sqlite3_stmt* list = takeCached(text);
    if (!list) {
        CString utf8 = text.utf8();
        if (sqlite3_prepare_v3(m_db, utf8.data(), static_cast<int>(utf8.length()), SQLITE_PREPARE_PERSISTENT, &list, nullptr) != SQLITE_OK)
            return false;
    }
    Vector<TextBinding, 5> bindings;
    for (auto& value : bound)
        bindings.append(TextBinding(value));
    for (unsigned i = 0; i < bindings.size(); i++)
        bindings[i].bind(list, static_cast<int>(i + 1));
    bool ok = true;
    for (;;) {
        int result = sqlite3_step(list);
        if (result == SQLITE_DONE)
            break;
        if (result != SQLITE_ROW) {
            ok = false;
            break;
        }
        const void* blob = sqlite3_column_blob(list, 1);
        size_t length = static_cast<size_t>(sqlite3_column_bytes(list, 1));
        if (!row(columnText(list, 0), std::span { static_cast<const uint8_t*>(blob), length }))
            break;
    }
    sqlite3_reset(list);
    sqlite3_clear_bindings(list);
    giveBack(text, list);
    return ok;
}

bool DurableObjectDatabase::deleteAll()
{
    if (!exec("DELETE FROM _cf_KV") || !exec("DELETE FROM _cf_METADATA"))
        return false;
    m_alarmDirty = true;
    exec("PRAGMA defer_foreign_keys = ON");
    for (auto kind : { "trigger"_s, "view"_s, "table"_s }) {
        Vector<String> names;
        sqlite3_stmt* select = nullptr;
        if (sqlite3_prepare_v2(m_db, "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'", -1, &select, nullptr) != SQLITE_OK)
            return false;
        sqlite3_bind_text(select, 1, kind.characters(), static_cast<int>(kind.length()), SQLITE_STATIC);
        while (sqlite3_step(select) == SQLITE_ROW)
            names.append(columnText(select, 0));
        sqlite3_finalize(select);
        for (auto& name : names) {
            // (A virtual table's shadow tables go with it, so a later name may already be gone.)
            String drop = makeString("DROP "_s, kind, " IF EXISTS \""_s, makeStringByReplacingAll(name, "\""_s, "\"\""_s), '"');
            if (!exec(drop.utf8().data()) && kind != "table"_s)
                return false;
        }
    }
    for (auto& entry : m_cache)
        sqlite3_finalize(entry.value);
    m_cache.clear();
    return true;
}

bool DurableObjectDatabase::isEmpty()
{
    for (auto sql : { "SELECT 1 FROM _cf_KV LIMIT 1", "SELECT 1 FROM _cf_METADATA LIMIT 1", "SELECT 1 FROM sqlite_master WHERE name NOT LIKE '\\_cf\\_%' ESCAPE '\\' LIMIT 1" }) {
        sqlite3_stmt* select = nullptr;
        if (sqlite3_prepare_v2(m_db, sql, -1, &select, nullptr) != SQLITE_OK)
            return false;
        int result = sqlite3_step(select);
        sqlite3_finalize(select);
        if (result != SQLITE_DONE)
            return false;
    }
    return true;
}

bool DurableObjectDatabase::alarmTime(std::optional<int64_t>& time)
{
    sqlite3_stmt* get = statement(m_metaGet, "SELECT value FROM _cf_METADATA WHERE key = ?");
    if (!get)
        return false;
    StatementReset reset(get);
    sqlite3_bind_int(get, 1, metaAlarm);
    int result = sqlite3_step(get);
    if (result == SQLITE_ROW)
        time = sqlite3_column_int64(get, 0);
    else
        time = std::nullopt;
    return result == SQLITE_ROW || result == SQLITE_DONE;
}

bool DurableObjectDatabase::setAlarm(int64_t time)
{
    sqlite3_stmt* put = statement(m_metaPut, "INSERT INTO _cf_METADATA (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
    if (!put)
        return false;
    StatementReset reset(put);
    sqlite3_bind_int(put, 1, metaAlarm);
    sqlite3_bind_int64(put, 2, time);
    m_alarmDirty = true;
    return sqlite3_step(put) == SQLITE_DONE;
}

bool DurableObjectDatabase::deleteAlarm()
{
    sqlite3_stmt* del = statement(m_metaDelete, "DELETE FROM _cf_METADATA WHERE key = ?");
    if (!del)
        return false;
    StatementReset reset(del);
    sqlite3_bind_int(del, 1, metaAlarm);
    m_alarmDirty = true;
    return sqlite3_step(del) == SQLITE_DONE;
}

bool DurableObjectDatabase::prepareNext(const CString& sql, size_t& offset, sqlite3_stmt*& prepared)
{
    prepared = nullptr;
    while (offset < sql.length() && !prepared) {
        const char* head = sql.data() + offset;
        const char* tail = nullptr;
        if (sqlite3_prepare_v3(m_db, head, static_cast<int>(sql.length() - offset), 0, &prepared, &tail) != SQLITE_OK)
            return false;
        offset = !tail || tail == head ? sql.length() : static_cast<size_t>(tail - sql.data());
    }
    return true;
}

// Whether nothing but white space, semicolons and comments is left of `sql` from `offset`.
static bool restIsBlank(const CString& sql, size_t offset)
{
    const char* p = sql.data() + offset;
    const char* end = sql.data() + sql.length();
    while (p < end) {
        if (isASCIIWhitespace(*p) || *p == ';') {
            p++;
            continue;
        }
        if (p + 1 < end && p[0] == '-' && p[1] == '-') {
            while (p < end && *p != '\n')
                p++;
            continue;
        }
        if (p + 1 < end && p[0] == '/' && p[1] == '*') {
            p += 2;
            while (p + 1 < end && !(p[0] == '*' && p[1] == '/'))
                p++;
            p = std::min(p + 2, end);
            continue;
        }
        return false;
    }
    return true;
}

sqlite3_stmt* DurableObjectDatabase::takeCached(const String& sql)
{
    return m_cache.take(sql);
}

void DurableObjectDatabase::giveBack(const String& sql, sqlite3_stmt* prepared)
{
    if (!m_db || m_cache.size() >= maxCachedStatements || m_cache.contains(sql)) {
        sqlite3_finalize(prepared);
        return;
    }
    m_cache.add(sql, prepared);
}

int64_t DurableObjectDatabase::databaseSize()
{
    int64_t pages = 0, pageSize = 0;
    for (auto [sql, out] : { std::pair { "PRAGMA page_count", &pages }, std::pair { "PRAGMA page_size", &pageSize } }) {
        sqlite3_stmt* pragma = nullptr;
        if (sqlite3_prepare_v2(m_db, sql, -1, &pragma, nullptr) != SQLITE_OK)
            return 0;
        if (sqlite3_step(pragma) == SQLITE_ROW)
            *out = sqlite3_column_int64(pragma, 0);
        sqlite3_finalize(pragma);
    }
    return pages * pageSize;
}

// ─── The alarm index ─────────────────────────────────────────────────────────

std::unique_ptr<DurableObjectAlarmIndex> DurableObjectAlarmIndex::open(const String& directory, String& error, bool& inUse)
{
    inUse = false;
    if (!loadSQLite(error))
        return nullptr;
    if (!directory.isNull() && !makeDirectory(directory, error))
        return nullptr;
    auto index = std::unique_ptr<DurableObjectAlarmIndex>(new DurableObjectAlarmIndex());
    CString filename = directory.isNull() ? CString(":memory:") : makeString(directory, PLATFORM_SEP_s, "namespace.sqlite"_s).utf8();
    int result = sqlite3_open_v2(filename.data(), &index->m_db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_NOMUTEX | SQLITE_OPEN_EXRESCODE, nullptr);
    if (result != SQLITE_OK) {
        error = index->m_db ? sqliteMessage(index->m_db) : String::fromUTF8(sqlite3_errstr(result));
        return nullptr;
    }
    auto exec = [&](const char* sql) { return sqlite3_exec(index->m_db, sql, nullptr, nullptr, nullptr) == SQLITE_OK; };
    // One namespace per storage directory: an object running twice would not be one object. The
    // exclusive lock is taken by the first write and held for as long as the namespace is open.
    bool ok = (directory.isNull() || (exec("PRAGMA locking_mode = EXCLUSIVE") && exec("PRAGMA journal_mode = WAL") && exec("PRAGMA synchronous = NORMAL")))
        && exec("CREATE TABLE IF NOT EXISTS alarms (id TEXT PRIMARY KEY, time INTEGER NOT NULL) WITHOUT ROWID")
        && exec("CREATE INDEX IF NOT EXISTS alarms_time ON alarms (time)")
        && exec("BEGIN IMMEDIATE; COMMIT");
    auto prepare = [&](sqlite3_stmt*& slot, const char* sql) { return sqlite3_prepare_v3(index->m_db, sql, -1, SQLITE_PREPARE_PERSISTENT, &slot, nullptr) == SQLITE_OK; };
    ok = ok && prepare(index->m_set, "INSERT INTO alarms (id, time) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET time = excluded.time")
        && prepare(index->m_hint, "INSERT INTO alarms (id, time) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET time = min(time, excluded.time)")
        && prepare(index->m_delete, "DELETE FROM alarms WHERE id = ?")
        && prepare(index->m_next, "SELECT min(time) FROM alarms")
        && prepare(index->m_due, "SELECT id FROM alarms WHERE time <= ? ORDER BY time LIMIT 256");
    if (!ok) {
        int code = sqlite3_errcode(index->m_db);
        inUse = (code & 0xff) == SQLITE_BUSY || (code & 0xff) == SQLITE_LOCKED;
        error = sqliteMessage(index->m_db);
        return nullptr;
    }
    return index;
}

DurableObjectAlarmIndex::~DurableObjectAlarmIndex()
{
    for (sqlite3_stmt* prepared : { m_set, m_hint, m_delete, m_next, m_due }) {
        if (prepared)
            sqlite3_finalize(prepared);
    }
    if (m_db)
        sqlite3_close_v2(m_db);
}

void DurableObjectAlarmIndex::set(const String& hex, std::optional<int64_t> time)
{
    sqlite3_stmt* prepared = time ? m_set : m_delete;
    StatementReset reset(prepared);
    TextBinding text(hex);
    text.bind(prepared, 1);
    if (time)
        sqlite3_bind_int64(prepared, 2, *time);
    sqlite3_step(prepared);
}

void DurableObjectAlarmIndex::hint(const String& hex, int64_t time)
{
    StatementReset reset(m_hint);
    TextBinding text(hex);
    text.bind(m_hint, 1);
    sqlite3_bind_int64(m_hint, 2, time);
    sqlite3_step(m_hint);
}

std::optional<int64_t> DurableObjectAlarmIndex::next()
{
    StatementReset reset(m_next);
    if (sqlite3_step(m_next) != SQLITE_ROW || sqlite3_column_type(m_next, 0) == SQLITE_NULL)
        return std::nullopt;
    return sqlite3_column_int64(m_next, 0);
}

Vector<String> DurableObjectAlarmIndex::due(int64_t now)
{
    Vector<String> ids;
    StatementReset reset(m_due);
    sqlite3_bind_int64(m_due, 1, now);
    while (sqlite3_step(m_due) == SQLITE_ROW)
        ids.append(columnText(m_due, 0));
    return ids;
}

// ─── JSDurableObjectActor: storage ───────────────────────────────────────────

static JSObject* createStorageError(JSGlobalObject* globalObject, DurableObjectDatabase* database)
{
    VM& vm = globalObject->vm();
    int code = database->lastErrorCode();
    JSObject* error = createError(globalObject, database->lastError());
    String codeString;
    switch (code) {
#define MACRO(SQLITE_DEF)             \
    case SQLITE_DEF:                  \
        codeString = #SQLITE_DEF##_s; \
        break;
        FOR_EACH_SQLITE_ERROR(MACRO)
#undef MACRO
    }
    auto& names = WebCore::builtinNames(vm);
    error->putDirect(vm, vm.propertyNames->name, jsString(vm, String("SQLiteError"_s)), static_cast<unsigned>(PropertyAttribute::DontEnum));
    if (!codeString.isEmpty())
        error->putDirect(vm, names.codePublicName(), jsString(vm, codeString), 0);
    error->putDirect(vm, names.errnoPublicName(), jsNumber(code), 0);
    return error;
}

static void throwStorageError(JSGlobalObject* globalObject, ThrowScope& scope, DurableObjectDatabase* database)
{
    throwException(globalObject, scope, createStorageError(globalObject, database));
}

DurableObjectDatabase* JSDurableObjectActor::database(Zig::GlobalObject* globalObject)
{
    if (m_database)
        return m_database.get();
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* owner = ns();
    String path = owner->storageDirectory().isNull() ? String() : durableObjectDatabasePath(owner->storageDirectory(), id()->hex()->value(globalObject));
    RETURN_IF_EXCEPTION(scope, nullptr);
    String error;
    // Opened in the namespace's context: the file is the namespace's to close, not the object's graph's.
    ModuleGraphContextScope context(owner->context());
    m_database = DurableObjectDatabase::open(path, error);
    if (!m_database) {
        throwException(globalObject, scope, createError(globalObject, ErrorCode::ERR_SQLITE_ERROR, error));
        return nullptr;
    }
    return m_database.get();
}

void JSDurableObjectActor::closeDatabase()
{
    if (!m_database)
        return;
    m_database->close(true);
    m_database = nullptr;
}

bool JSDurableObjectActor::beginWrite(Zig::GlobalObject* globalObject, DurableObjectDatabase* database)
{
    if (!database->write()) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        throwStorageError(globalObject, scope, database);
        return false;
    }
    if (!m_commitScheduled && !database->depth()) {
        m_commitScheduled = true;
        VM& vm = globalObject->vm();
        QueuedTask task { nullptr, InternalMicrotask::BunInvokeJobWithArguments, 0, globalObject, JSDurableObjectRealm::of(globalObject)->function(JSDurableObjectRealm::Field::CommitMicrotask), this, jsNumber(m_generation) };
        vm.queueMicrotask(WTF::move(task));
    }
    return true;
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectCommitMicrotask, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* actor = dynamicDowncast<JSDurableObjectActor>(callFrame->argument(0));
    if (!actor)
        return JSValue::encode(jsUndefined());
    actor->m_commitScheduled = false;
    if (actor->generation() == callFrame->argument(1).asUInt32()) {
        ModuleGraphContextScope context(actor->ns()->context());
        actor->flush(globalObject);
    }
    return JSValue::encode(jsUndefined());
}

bool JSDurableObjectActor::flush(Zig::GlobalObject* globalObject)
{
    auto* database = m_database.get();
    if (!database || !database->inTransaction() || database->depth())
        return true;
    if (!database->flush()) {
        VM& vm = globalObject->vm();
        JSObject* cause = createStorageError(globalObject, database);
        JSObject* error = createError(globalObject, ErrorCode::ERR_DURABLE_OBJECT_RESET, "Durable Object storage could not be written; the object was reset"_s);
        error->putDirect(vm, vm.propertyNames->cause, cause, static_cast<unsigned>(PropertyAttribute::DontEnum));
        abort(globalObject, error);
        return false;
    }
    if (database->m_alarmDirty) {
        database->m_alarmDirty = false;
        alarmChanged(globalObject);
    }
    return true;
}

// ─── Reaching the database from script ───────────────────────────────────────

struct StorageAccess {
    JSDurableObjectActor* actor { nullptr };
    DurableObjectDatabase* database { nullptr };
    explicit operator bool() const { return database; }
};

static StorageAccess accessStorage(Zig::GlobalObject* globalObject, ThrowScope& scope, JSValue thisValue, JSDurableObjectHandle::Kind kind, ASCIILiteral className, ASCIILiteral method)
{
    JSDurableObjectHandle* handle = toCurrentHandle(globalObject, scope, thisValue, kind, className, method);
    RETURN_IF_EXCEPTION(scope, {});
    if (kind == JSDurableObjectHandle::Kind::Transaction) {
        if (handle->m_finished) {
            Bun::ERR::INVALID_STATE(scope, globalObject, "This transaction has already finished"_s);
            return {};
        }
        if (handle->m_rolledBack) {
            Bun::ERR::INVALID_STATE(scope, globalObject, "This transaction was rolled back"_s);
            return {};
        }
    }
    auto* actor = handle->actor();
    auto* database = actor->database(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return { actor, database };
}

static bool validateKey(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral name, String& key)
{
    if (!value.isString()) {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "string"_s, value);
        return false;
    }
    key = asString(value)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    if (key.length() > maxKeyBytes / 3 && key.utf8().length() > maxKeyBytes) {
        Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, name, value, makeString("must be at most "_s, maxKeyBytes, " bytes"_s));
        return false;
    }
    return true;
}

static JSValue deserializeValue(Zig::GlobalObject* globalObject, ThrowScope& scope, Vector<uint8_t>&& bytes)
{
    auto serialized = WebCore::SerializedScriptValue::createFromWireBytes(WTF::move(bytes));
    RELEASE_AND_RETURN(scope, serialized->deserialize(*globalObject, globalObject, WebCore::SerializationErrorMode::Throwing));
}

static JSValue kvGet(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access, const String& key)
{
    Vector<uint8_t> bytes;
    switch (access.database->kvGet(key, bytes)) {
    case DurableObjectDatabase::Lookup::Missing:
        return jsUndefined();
    case DurableObjectDatabase::Lookup::Failed:
        throwStorageError(globalObject, scope, access.database);
        return {};
    case DurableObjectDatabase::Lookup::Found:
        break;
    }
    RELEASE_AND_RETURN(scope, deserializeValue(globalObject, scope, WTF::move(bytes)));
}

static void kvPut(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access, const String& key, JSValue value)
{
    if (value.isUndefined()) {
        Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "value"_s, value, "cannot be undefined"_s);
        return;
    }
    RefPtr serialized = WebCore::SerializedScriptValue::create(*globalObject, value, WebCore::SerializationForStorage::Yes, WebCore::SerializationErrorMode::Throwing);
    RETURN_IF_EXCEPTION(scope, );
    if (!serialized) {
        throwTypeError(globalObject, scope, "This value cannot be stored: it cannot be cloned"_s);
        return;
    }
    access.actor->beginWrite(globalObject, access.database);
    RETURN_IF_EXCEPTION(scope, );
    if (!access.database->kvPut(key, serialized->wireBytes().span()))
        throwStorageError(globalObject, scope, access.database);
}

static bool kvDelete(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access, const String& key)
{
    access.actor->beginWrite(globalObject, access.database);
    RETURN_IF_EXCEPTION(scope, false);
    bool existed = false;
    if (!access.database->kvDelete(key, existed))
        throwStorageError(globalObject, scope, access.database);
    return existed;
}

static bool readListOptions(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, DurableObjectDatabase::ListOptions& options)
{
    if (value.isUndefinedOrNull())
        return true;
    V::validateObject(scope, globalObject, value, "options"_s);
    RETURN_IF_EXCEPTION(scope, false);
    VM& vm = globalObject->vm();
    JSObject* object = asObject(value);
    auto readKey = [&](ASCIILiteral name, ASCIILiteral argumentName, String& out) {
        JSValue property = object->get(globalObject, Identifier::fromString(vm, name));
        RETURN_IF_EXCEPTION(scope, false);
        if (property.isUndefined())
            return true;
        return validateKey(globalObject, scope, property, argumentName, out);
    };
    if (!readKey("start"_s, "options.start"_s, options.start) || !readKey("startAfter"_s, "options.startAfter"_s, options.startAfter)
        || !readKey("end"_s, "options.end"_s, options.end) || !readKey("prefix"_s, "options.prefix"_s, options.prefix))
        return false;
    if (!options.start.isNull() && !options.startAfter.isNull()) {
        Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "options"_s, value, "takes either \"start\" or \"startAfter\", not both"_s);
        return false;
    }
    JSValue reverse = object->get(globalObject, Identifier::fromString(vm, "reverse"_s));
    RETURN_IF_EXCEPTION(scope, false);
    options.reverse = reverse.toBoolean(globalObject);
    JSValue limit = object->get(globalObject, Identifier::fromString(vm, "limit"_s));
    RETURN_IF_EXCEPTION(scope, false);
    if (!limit.isUndefined()) {
        if (!limit.isNumber() || !(limit.asNumber() >= 1) || limit.asNumber() != std::trunc(limit.asNumber()) || limit.asNumber() > static_cast<double>(maxSafeInteger())) {
            Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "options.limit"_s, limit, "must be a positive integer"_s);
            return false;
        }
        options.limit = static_cast<int64_t>(limit.asNumber());
    }
    return true;
}

// Every [key, value] the options select, in key order, given to `each`.
static void kvList(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access, JSValue optionsValue, const Function<void(JSString*, JSValue)>& each)
{
    DurableObjectDatabase::ListOptions options;
    if (!readListOptions(globalObject, scope, optionsValue, options))
        return;
    VM& vm = globalObject->vm();
    // Deserializing runs no script, but it allocates: collect the rows first so that no
    // statement is mid-step while the collector runs finalizers that touch this database.
    Vector<std::pair<String, Vector<uint8_t>>> rows;
    bool ok = access.database->kvList(options, [&](String&& key, std::span<const uint8_t> value) {
        rows.append({ WTF::move(key), Vector<uint8_t>(value) });
        return true;
    });
    if (!ok) {
        throwStorageError(globalObject, scope, access.database);
        return;
    }
    for (auto& row : rows) {
        JSValue value = deserializeValue(globalObject, scope, WTF::move(row.second));
        RETURN_IF_EXCEPTION(scope, );
        each(jsString(vm, row.first), value);
        RETURN_IF_EXCEPTION(scope, );
    }
}

static int compareKeysAsUTF8(const String& a, const String& b)
{
    CString left = a.utf8(), right = b.utf8();
    int result = memcmp(left.data(), right.data(), std::min(left.length(), right.length()));
    if (result)
        return result;
    return left.length() < right.length() ? -1 : left.length() > right.length();
}

static JSValue storageGet(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access, JSValue keys)
{
    VM& vm = globalObject->vm();
    if (keys.isString()) {
        String key;
        if (!validateKey(globalObject, scope, keys, "key"_s, key))
            return {};
        RELEASE_AND_RETURN(scope, kvGet(globalObject, scope, access, key));
    }
    if (!isArray(globalObject, keys)) {
        RETURN_IF_EXCEPTION(scope, {});
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "key"_s, "string or Array"_s, keys);
        return {};
    }
    Vector<String> sorted;
    forEachInArrayLike(globalObject, asObject(keys), [&](JSValue element) {
        String key;
        if (!validateKey(globalObject, scope, element, "key"_s, key))
            return false;
        sorted.append(WTF::move(key));
        return true;
    });
    RETURN_IF_EXCEPTION(scope, {});
    std::sort(sorted.begin(), sorted.end(), [](const String& a, const String& b) { return compareKeysAsUTF8(a, b) < 0; });
    JSMap* map = JSMap::create(vm, globalObject->mapStructure());
    for (auto& key : sorted) {
        JSValue value = kvGet(globalObject, scope, access, key);
        RETURN_IF_EXCEPTION(scope, {});
        if (value.isUndefined())
            continue;
        map->set(globalObject, jsString(vm, key), value);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return map;
}

// Runs `body` inside a savepoint: what it wrote stays only if it returns true.
static bool inScope(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access, const Function<bool()>& body)
{
    access.actor->beginWrite(globalObject, access.database);
    RETURN_IF_EXCEPTION(scope, false);
    if (!access.database->beginScope()) {
        throwStorageError(globalObject, scope, access.database);
        return false;
    }
    uint32_t generation = access.actor->generation();
    bool ok = body();
    if (access.actor->generation() != generation)
        return false;
    if (!access.database->endScope(ok) && ok) {
        throwStorageError(globalObject, scope, access.database);
        ok = false;
    }
    // The outermost scope closed: the commit a write inside it could not schedule.
    if (!access.database->depth() && !scope.exception()) {
        access.actor->beginWrite(globalObject, access.database);
        RETURN_IF_EXCEPTION(scope, false);
    }
    return ok;
}

static JSValue storagePut(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access, JSValue keyOrEntries, JSValue value)
{
    VM& vm = globalObject->vm();
    if (keyOrEntries.isString()) {
        String key;
        if (!validateKey(globalObject, scope, keyOrEntries, "key"_s, key))
            return {};
        kvPut(globalObject, scope, access, key, value);
        RETURN_IF_EXCEPTION(scope, {});
        return jsUndefined();
    }
    if (!keyOrEntries.isObject()) {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "key"_s, "string or object"_s, keyOrEntries);
        return {};
    }
    JSObject* entries = asObject(keyOrEntries);
    PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    entries->methodTable()->getOwnPropertyNames(entries, globalObject, names, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, {});
    inScope(globalObject, scope, access, [&] {
        for (auto& name : names) {
            JSValue entry = entries->get(globalObject, name);
            RETURN_IF_EXCEPTION(scope, false);
            if (entry.isUndefined())
                continue;
            String key = name.string();
            if (key.length() > maxKeyBytes / 3 && key.utf8().length() > maxKeyBytes) {
                Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "key"_s, jsString(vm, key), makeString("must be at most "_s, maxKeyBytes, " bytes"_s));
                return false;
            }
            kvPut(globalObject, scope, access, key, entry);
            RETURN_IF_EXCEPTION(scope, false);
        }
        return true;
    });
    RETURN_IF_EXCEPTION(scope, {});
    return jsUndefined();
}

static JSValue storageDelete(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access, JSValue keys)
{
    if (keys.isString()) {
        String key;
        if (!validateKey(globalObject, scope, keys, "key"_s, key))
            return {};
        bool existed = kvDelete(globalObject, scope, access, key);
        RETURN_IF_EXCEPTION(scope, {});
        return jsBoolean(existed);
    }
    if (!isArray(globalObject, keys)) {
        RETURN_IF_EXCEPTION(scope, {});
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "key"_s, "string or Array"_s, keys);
        return {};
    }
    Vector<String> list;
    forEachInArrayLike(globalObject, asObject(keys), [&](JSValue element) {
        String key;
        if (!validateKey(globalObject, scope, element, "key"_s, key))
            return false;
        list.append(WTF::move(key));
        return true;
    });
    RETURN_IF_EXCEPTION(scope, {});
    unsigned count = 0;
    inScope(globalObject, scope, access, [&] {
        for (auto& key : list) {
            bool existed = kvDelete(globalObject, scope, access, key);
            RETURN_IF_EXCEPTION(scope, false);
            count += existed;
        }
        return true;
    });
    RETURN_IF_EXCEPTION(scope, {});
    return jsNumber(count);
}

static JSValue storageGetAlarm(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access)
{
    // The alarm that is running counts as gone unless the handler set another.
    if (access.actor->m_alarmRunning && !access.actor->m_alarmTouched)
        return jsNull();
    std::optional<int64_t> time;
    if (!access.database->alarmTime(time)) {
        throwStorageError(globalObject, scope, access.database);
        return {};
    }
    return time ? jsNumber(static_cast<double>(*time)) : jsNull();
}

static JSValue storageSetAlarm(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access, JSValue scheduledTime)
{
    VM& vm = globalObject->vm();
    double time;
    if (auto* date = dynamicDowncast<DateInstance>(scheduledTime))
        time = date->internalNumber();
    else if (scheduledTime.isNumber())
        time = scheduledTime.asNumber();
    else {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "scheduledTime"_s, "number or Date"_s, scheduledTime);
        return {};
    }
    if (!(time >= 0) || !std::isfinite(time) || time > static_cast<double>(maxSafeInteger())) {
        Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "scheduledTime"_s, scheduledTime, "must be a time in milliseconds since the epoch"_s);
        return {};
    }
    if (JSObject* instance = access.actor->instance()) {
        JSValue handler = instance->get(globalObject, Identifier::fromString(vm, "alarm"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!handler.isCallable()) {
            throwTypeError(globalObject, scope, "This Durable Object class has no alarm() handler, which setAlarm() needs"_s);
            return {};
        }
    }
    access.actor->beginWrite(globalObject, access.database);
    RETURN_IF_EXCEPTION(scope, {});
    int64_t when = static_cast<int64_t>(std::floor(time));
    if (!access.database->setAlarm(when)) {
        throwStorageError(globalObject, scope, access.database);
        return {};
    }
    if (access.actor->m_alarmRunning)
        access.actor->m_alarmTouched = true;
    // The namespace's timer hears of the time before it is committed; see DurableObjectAlarmIndex.
    auto* owner = access.actor->ns();
    String hex = access.actor->id()->hex()->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    owner->alarmIndex().hint(hex, when);
    owner->scheduleAlarms();
    owner->updateKeepAlive();
    return jsUndefined();
}

static JSValue storageDeleteAlarm(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access)
{
    access.actor->beginWrite(globalObject, access.database);
    RETURN_IF_EXCEPTION(scope, {});
    if (!access.database->deleteAlarm()) {
        throwStorageError(globalObject, scope, access.database);
        return {};
    }
    if (access.actor->m_alarmRunning)
        access.actor->m_alarmTouched = true;
    return jsUndefined();
}

// The asynchronous API answers with promises that are already settled: SQLite is synchronous,
// and the object is not interleaved with other events while it awaits them (JSDurableObjectActor::enqueue).
static EncodedJSValue settled(Zig::GlobalObject* globalObject, ThrowScope& scope, JSValue value)
{
    if (scope.exception()) [[unlikely]]
        return JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(globalObject, scope));
    RELEASE_AND_RETURN(scope, JSValue::encode(JSPromise::resolvedPromise(globalObject, value)));
}

#define STORAGE_OR_TRANSACTION(className, kind, method)                                                                     \
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);                                                          \
    VM& vm = globalObject->vm();                                                                                            \
    auto scope = DECLARE_THROW_SCOPE(vm);                                                                                   \
    StorageAccess access = accessStorage(globalObject, scope, callFrame->thisValue(), JSDurableObjectHandle::Kind::kind, className, method); \
    if (!access) [[unlikely]]                                                                                               \
        return settled(globalObject, scope, {});

#define DEFINE_ASYNC_STORAGE_FUNCTIONS(prefix, className, kind)                                                                   \
    JSC_DEFINE_HOST_FUNCTION(prefix##Get, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))                           \
    {                                                                                                                             \
        STORAGE_OR_TRANSACTION(className, kind, "get"_s)                                                                          \
        JSValue result = storageGet(globalObject, scope, access, callFrame->argument(0));                                         \
        return settled(globalObject, scope, result);                                                                              \
    }                                                                                                                             \
    JSC_DEFINE_HOST_FUNCTION(prefix##List, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))                          \
    {                                                                                                                             \
        STORAGE_OR_TRANSACTION(className, kind, "list"_s)                                                                         \
        JSMap* map = JSMap::create(vm, globalObject->mapStructure());                                                             \
        kvList(globalObject, scope, access, callFrame->argument(0), [&](JSString* key, JSValue value) { map->set(globalObject, key, value); }); \
        return settled(globalObject, scope, map);                                                                                 \
    }                                                                                                                             \
    JSC_DEFINE_HOST_FUNCTION(prefix##Put, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))                           \
    {                                                                                                                             \
        STORAGE_OR_TRANSACTION(className, kind, "put"_s)                                                                          \
        JSValue result = storagePut(globalObject, scope, access, callFrame->argument(0), callFrame->argument(1));                 \
        return settled(globalObject, scope, result);                                                                              \
    }                                                                                                                             \
    JSC_DEFINE_HOST_FUNCTION(prefix##Delete, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))                        \
    {                                                                                                                             \
        STORAGE_OR_TRANSACTION(className, kind, "delete"_s)                                                                       \
        JSValue result = storageDelete(globalObject, scope, access, callFrame->argument(0));                                      \
        return settled(globalObject, scope, result);                                                                              \
    }                                                                                                                             \
    JSC_DEFINE_HOST_FUNCTION(prefix##GetAlarm, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))                      \
    {                                                                                                                             \
        STORAGE_OR_TRANSACTION(className, kind, "getAlarm"_s)                                                                     \
        JSValue result = storageGetAlarm(globalObject, scope, access);                                                            \
        return settled(globalObject, scope, result);                                                                              \
    }                                                                                                                             \
    JSC_DEFINE_HOST_FUNCTION(prefix##SetAlarm, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))                      \
    {                                                                                                                             \
        STORAGE_OR_TRANSACTION(className, kind, "setAlarm"_s)                                                                     \
        JSValue result = storageSetAlarm(globalObject, scope, access, callFrame->argument(0));                                    \
        return settled(globalObject, scope, result);                                                                              \
    }                                                                                                                             \
    JSC_DEFINE_HOST_FUNCTION(prefix##DeleteAlarm, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))                   \
    {                                                                                                                             \
        STORAGE_OR_TRANSACTION(className, kind, "deleteAlarm"_s)                                                                  \
        JSValue result = storageDeleteAlarm(globalObject, scope, access);                                                         \
        return settled(globalObject, scope, result);                                                                              \
    }

DEFINE_ASYNC_STORAGE_FUNCTIONS(jsDurableObjectStorage, "DurableObjectStorage"_s, Storage)
DEFINE_ASYNC_STORAGE_FUNCTIONS(jsDurableObjectTransaction, "DurableObjectTransaction"_s, Transaction)

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStorageDeleteAll, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_OR_TRANSACTION("DurableObjectStorage"_s, Storage, "deleteAll"_s)
    inScope(globalObject, scope, access, [&] {
        if (access.database->deleteAll())
            return true;
        throwStorageError(globalObject, scope, access.database);
        return false;
    });
    if (access.actor->m_alarmRunning)
        access.actor->m_alarmTouched = true;
    return settled(globalObject, scope, jsUndefined());
}

// Every write is committed before anything the object says leaves it; there is nothing more to wait for.
JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStorageSync, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_OR_TRANSACTION("DurableObjectStorage"_s, Storage, "sync"_s)
    ModuleGraphContextScope context(access.actor->ns()->context());
    if (!access.actor->flush(globalObject))
        throwException(globalObject, scope, createDurableObjectResetError(globalObject));
    return settled(globalObject, scope, jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStorageTransactionSync, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    StorageAccess access = accessStorage(globalObject, scope, callFrame->thisValue(), JSDurableObjectHandle::Kind::Storage, "DurableObjectStorage"_s, "transactionSync"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue closure = callFrame->argument(0);
    V::validateFunction(scope, globalObject, closure, "closure"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue result;
    inScope(globalObject, scope, access, [&] {
        result = JSC::call(globalObject, closure, JSC::getCallData(closure), jsUndefined(), ArgList());
        return !scope.exception();
    });
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

// An asynchronous closure whose writes are committed together or not at all. Other events of
// the object wait until it has finished.
JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStorageTransaction, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_OR_TRANSACTION("DurableObjectStorage"_s, Storage, "transaction"_s)
    JSValue closure = callFrame->argument(0);
    V::validateFunction(scope, globalObject, closure, "closure"_s);
    if (scope.exception()) [[unlikely]]
        return settled(globalObject, scope, {});
    access.actor->beginWrite(globalObject, access.database);
    if (scope.exception()) [[unlikely]]
        return settled(globalObject, scope, {});
    if (!access.database->beginScope()) {
        throwStorageError(globalObject, scope, access.database);
        return settled(globalObject, scope, {});
    }
    auto* realm = JSDurableObjectRealm::of(globalObject);
    auto* transaction = JSDurableObjectHandle::create(vm, realm->structure(JSDurableObjectRealm::Field::TransactionStructure), JSDurableObjectHandle::Kind::Transaction, access.actor);
    access.actor->m_blockers++;
    JSPromise* outer = JSPromise::create(vm, globalObject->promiseStructure());
    auto* continuation = JSDurableObjectEvent::create(vm, globalObject, DurableObjectEventKind::Transaction, access.actor, transaction, jsUndefined(), jsUndefined(), outer);

    MarkedArgumentBuffer closureArguments;
    closureArguments.append(transaction);
    JSValue result = JSC::call(globalObject, closure, JSC::getCallData(closure), jsUndefined(), closureArguments);
    if (scope.exception()) [[unlikely]] {
        JSValue error = scope.exception()->value();
        (void)scope.tryClearException();
        finishDurableObjectTransaction(globalObject, continuation, false);
        outer->reject(vm, error);
        return JSValue::encode(outer);
    }
    JSPromise* awaited = dynamicDowncast<JSPromise>(result);
    if (!awaited)
        awaited = JSPromise::resolvedPromise(globalObject, result);
    RETURN_IF_EXCEPTION(scope, {});
    ModuleGraphContextScope context(access.actor->ns()->context());
    awaited->performPromiseThenWithContext(vm, globalObject, realm->function(JSDurableObjectRealm::Field::OnFulfilled), realm->function(JSDurableObjectRealm::Field::OnRejected), jsUndefined(), continuation);
    return JSValue::encode(outer);
}

void finishDurableObjectTransaction(Zig::GlobalObject* globalObject, JSDurableObjectEvent* continuation, bool commit)
{
    auto* transaction = uncheckedDowncast<JSDurableObjectHandle>(continuation->a());
    auto* actor = continuation->actor();
    transaction->m_finished = true;
    if (actor->generation() != continuation->m_generation)
        return;
    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    if (auto* database = actor->databaseIfOpen(); database && database->depth()) {
        database->endScope(commit && !transaction->m_rolledBack);
        if (!database->depth()) {
            actor->beginWrite(globalObject, database);
            (void)scope.clearExceptionExceptTermination();
        }
    }
    actor->unblock(globalObject, continuation->m_generation);
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectTransactionRollback, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    accessStorage(globalObject, scope, callFrame->thisValue(), JSDurableObjectHandle::Kind::Transaction, "DurableObjectTransaction"_s, "rollback"_s);
    RETURN_IF_EXCEPTION(scope, {});
    uncheckedDowncast<JSDurableObjectHandle>(callFrame->thisValue())->m_rolledBack = true;
    return JSValue::encode(jsUndefined());
}

// ─── ctx.storage.kv ──────────────────────────────────────────────────────────

#define KV_ACCESS(method)                                                                                                                                        \
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);                                                                                               \
    VM& vm = globalObject->vm();                                                                                                                                 \
    auto scope = DECLARE_THROW_SCOPE(vm);                                                                                                                        \
    StorageAccess access = accessStorage(globalObject, scope, callFrame->thisValue(), JSDurableObjectHandle::Kind::Kv, "DurableObjectStorage.kv"_s, method);  \
    RETURN_IF_EXCEPTION(scope, {});

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectKvGet, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    KV_ACCESS("get"_s)
    String key;
    if (!validateKey(globalObject, scope, callFrame->argument(0), "key"_s, key))
        return {};
    RELEASE_AND_RETURN(scope, JSValue::encode(kvGet(globalObject, scope, access, key)));
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectKvPut, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    KV_ACCESS("put"_s)
    String key;
    if (!validateKey(globalObject, scope, callFrame->argument(0), "key"_s, key))
        return {};
    kvPut(globalObject, scope, access, key, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectKvDelete, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    KV_ACCESS("delete"_s)
    String key;
    if (!validateKey(globalObject, scope, callFrame->argument(0), "key"_s, key))
        return {};
    bool existed = kvDelete(globalObject, scope, access, key);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(existed));
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectKvList, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    KV_ACCESS("list"_s)
    MarkedArgumentBuffer entries;
    kvList(globalObject, scope, access, callFrame->argument(0), [&](JSString* key, JSValue value) {
        MarkedArgumentBuffer pair;
        pair.append(key);
        pair.append(value);
        entries.append(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), pair));
    });
    RETURN_IF_EXCEPTION(scope, {});
    JSArray* array = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), entries);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(JSArrayIterator::create(vm, globalObject->arrayIteratorStructure(), array, IterationKind::Values));
}

// ─── ctx.storage.sql ─────────────────────────────────────────────────────────

// What exec() returns. The statement is stepped as the cursor is read; one that returns no rows
// has run to completion before exec() returns.
class JSDurableObjectSqlCursor final : public JSDestructibleObject {
public:
    using Base = JSDestructibleObject;
    static constexpr DestructionMode needsDestruction = NeedsDestruction;
    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;
    template<typename, SubspaceAccess mode> static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        if constexpr (mode == SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSDurableObjectSqlCursor, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForDurableObjectSqlCursor, m_subspaceForDurableObjectSqlCursor));
    }
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
    }
    static JSDurableObjectSqlCursor* create(VM& vm, Structure* structure, JSDurableObjectActor* actor, JSDurableObjectSqlCursor* source)
    {
        auto* cursor = new (NotNull, allocateCell<JSDurableObjectSqlCursor>(vm)) JSDurableObjectSqlCursor(vm, structure);
        cursor->finishCreation(vm);
        cursor->m_actor.set(vm, cursor, actor);
        cursor->m_generation = actor->generation();
        if (source)
            cursor->m_source.set(vm, cursor, source);
        return cursor;
    }
    static void destroy(JSCell* cell) { static_cast<JSDurableObjectSqlCursor*>(cell)->~JSDurableObjectSqlCursor(); }
    ~JSDurableObjectSqlCursor()
    {
        if (m_statement)
            sqlite3_finalize(m_statement);
    }

    // raw(): the same rows, as arrays. Reads through to the cursor it was made from.
    JSDurableObjectSqlCursor* source() { return m_source ? m_source.get() : this; }
    bool isRaw() const { return !!m_source; }

    // The statement has a row ready (sqlite3_step returned SQLITE_ROW and it was not read yet).
    bool m_hasRow { false };
    bool m_done { false };
    sqlite3_stmt* m_statement { nullptr };
    String m_sql;
    uint32_t m_generation { 0 };
    double m_rowsRead { 0 };
    double m_rowsWritten { 0 };
    WriteBarrier<JSDurableObjectActor> m_actor;
    WriteBarrier<JSDurableObjectSqlCursor> m_source;
    WriteBarrier<JSArray> m_columnNames;
    WriteBarrier<Structure> m_rowStructure;

    DurableObjectDatabase* database() const
    {
        auto* actor = m_actor.get();
        return actor->generation() == m_generation ? actor->databaseIfOpen() : nullptr;
    }
    void finish()
    {
        m_done = true;
        m_hasRow = false;
        if (!m_statement)
            return;
        sqlite3_reset(m_statement);
        sqlite3_clear_bindings(m_statement);
        auto* owner = database();
        if (owner && !m_sql.isNull())
            owner->giveBack(m_sql, m_statement);
        else
            sqlite3_finalize(m_statement);
        m_statement = nullptr;
    }
    // Makes the next row ready. False at the end, or with an exception thrown.
    bool advance(Zig::GlobalObject* globalObject, ThrowScope& scope)
    {
        if (m_hasRow)
            return true;
        if (m_done)
            return false;
        auto* owner = database();
        if (!owner) {
            finish();
            throwException(globalObject, scope, createDurableObjectResetError(globalObject));
            return false;
        }
        int result;
        {
            DurableObjectDatabase::UserScope restricted(*owner);
            result = sqlite3_step(m_statement);
        }
        if (result == SQLITE_ROW) {
            m_hasRow = true;
            m_rowsRead++;
            return true;
        }
        if (result != SQLITE_DONE) {
            JSObject* error = createStorageError(globalObject, owner);
            finish();
            throwException(globalObject, scope, error);
            return false;
        }
        finish();
        return false;
    }
    JSValue column(Zig::GlobalObject* globalObject, ThrowScope& scope, int index)
    {
        VM& vm = globalObject->vm();
        switch (sqlite3_column_type(m_statement, index)) {
        case SQLITE_INTEGER:
            return jsNumber(static_cast<double>(sqlite3_column_int64(m_statement, index)));
        case SQLITE_FLOAT:
            return jsDoubleNumber(sqlite3_column_double(m_statement, index));
        case SQLITE_TEXT:
            return jsString(vm, columnText(m_statement, index));
        case SQLITE_BLOB: {
            size_t length = static_cast<size_t>(sqlite3_column_bytes(m_statement, index));
            auto* bytes = JSUint8Array::createUninitialized(globalObject, globalObject->m_typedArrayUint8.get(globalObject), length);
            RETURN_IF_EXCEPTION(scope, {});
            // (Read again: allocating may have run a finalizer that stepped another statement, never this one.)
            if (length)
                memcpy(bytes->typedVector(), sqlite3_column_blob(m_statement, index), length);
            return bytes;
        }
        default:
            return jsNull();
        }
    }
    // The row that is ready, consumed.
    JSValue takeRow(Zig::GlobalObject* globalObject, ThrowScope& scope, bool raw)
    {
        VM& vm = globalObject->vm();
        int count = sqlite3_column_count(m_statement);
        MarkedArgumentBuffer values;
        for (int i = 0; i < count; i++) {
            values.append(column(globalObject, scope, i));
            RETURN_IF_EXCEPTION(scope, {});
        }
        m_hasRow = false;
        if (raw)
            RELEASE_AND_RETURN(scope, constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), values));
        Structure* structure = m_rowStructure.get();
        if (structure) {
            JSObject* row = constructEmptyObject(vm, structure);
            for (int i = 0; i < count; i++)
                row->putDirectOffset(vm, i, values.at(i));
            return row;
        }
        // Too many columns for inline storage, or two with one name (the later one wins).
        JSObject* row = constructEmptyObject(globalObject);
        JSArray* names = m_columnNames.get();
        for (int i = 0; i < count; i++) {
            auto name = Identifier::fromString(vm, asString(names->getIndexQuickly(i))->value(globalObject));
            RETURN_IF_EXCEPTION(scope, {});
            row->putDirect(vm, name, values.at(i), 0);
        }
        return row;
    }
    void setColumns(Zig::GlobalObject* globalObject, ThrowScope& scope)
    {
        VM& vm = globalObject->vm();
        int count = m_statement ? sqlite3_column_count(m_statement) : 0;
        MarkedArgumentBuffer names;
        Vector<Identifier> identifiers;
        bool unique = true;
        for (int i = 0; i < count; i++) {
            const char* name = sqlite3_column_name(m_statement, i);
            String string = name ? String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const unsigned char*>(name), strlen(name) }) : emptyString();
            auto identifier = Identifier::fromString(vm, string);
            unique = unique && !identifiers.contains(identifier);
            identifiers.append(identifier);
            names.append(jsString(vm, string));
        }
        JSArray* array = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), names);
        RETURN_IF_EXCEPTION(scope, );
        m_columnNames.set(vm, this, array);
        if (!unique || !count || static_cast<unsigned>(count) > JSFinalObject::maxInlineCapacity)
            return;
        Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), count);
        for (int i = 0; i < count; i++) {
            PropertyOffset offset;
            structure = Structure::addPropertyTransition(vm, structure, identifiers[i], 0, offset);
        }
        m_rowStructure.set(vm, this, structure);
    }

private:
    JSDurableObjectSqlCursor(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }
};

const ClassInfo JSDurableObjectSqlCursor::s_info = { "SqlStorageCursor"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDurableObjectSqlCursor) };

template<typename Visitor>
void JSDurableObjectSqlCursor::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSDurableObjectSqlCursor>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_actor);
    visitor.append(thisObject->m_source);
    visitor.append(thisObject->m_columnNames);
    visitor.append(thisObject->m_rowStructure);
}
DEFINE_VISIT_CHILDREN(JSDurableObjectSqlCursor);

static bool bindParameter(Zig::GlobalObject* globalObject, ThrowScope& scope, sqlite3_stmt* prepared, int index, JSValue value)
{
    if (value.isUndefinedOrNull()) {
        sqlite3_bind_null(prepared, index);
        return true;
    }
    if (value.isInt32()) {
        sqlite3_bind_int(prepared, index, value.asInt32());
        return true;
    }
    if (value.isNumber()) {
        sqlite3_bind_double(prepared, index, value.asNumber());
        return true;
    }
    if (value.isBoolean()) {
        sqlite3_bind_int(prepared, index, value.asBoolean());
        return true;
    }
    if (value.isString()) {
        auto view = asString(value)->view(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        CString utf8 = view->utf8();
        sqlite3_bind_text64(prepared, index, utf8.data(), utf8.length(), SQLITE_TRANSIENT, SQLITE_UTF8);
        return true;
    }
    if (value.isBigInt()) {
        int64_t integer = JSBigInt::toBigInt64(value);
        JSValue back = JSBigInt::makeHeapBigIntOrBigInt32(globalObject, integer);
        RETURN_IF_EXCEPTION(scope, false);
        if (JSBigInt::compare(back, value) != JSBigInt::ComparisonResult::Equal) {
            Bun::ERR::OUT_OF_RANGE(scope, globalObject, makeString("bindings["_s, index - 1, ']'), "a 64-bit signed integer"_s, value);
            return false;
        }
        sqlite3_bind_int64(prepared, index, integer);
        return true;
    }
    if (auto* view = dynamicDowncast<JSArrayBufferView>(value)) {
        if (view->isDetached()) {
            throwTypeError(globalObject, scope, "Cannot bind a detached buffer"_s);
            return false;
        }
        sqlite3_bind_blob64(prepared, index, view->vector(), view->byteLength(), SQLITE_TRANSIENT);
        return true;
    }
    if (auto* buffer = dynamicDowncast<JSArrayBuffer>(value)) {
        auto* impl = buffer->impl();
        sqlite3_bind_blob64(prepared, index, impl->data(), impl->byteLength(), SQLITE_TRANSIENT);
        return true;
    }
    Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, makeString("bindings["_s, index - 1, ']'), "string, number, bigint, boolean, null, ArrayBuffer or TypedArray"_s, value);
    return false;
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectSqlExec, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    StorageAccess access = accessStorage(globalObject, scope, callFrame->thisValue(), JSDurableObjectHandle::Kind::Sql, "SqlStorage"_s, "exec"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue queryValue = callFrame->argument(0);
    V::validateString(scope, globalObject, queryValue, "query"_s);
    RETURN_IF_EXCEPTION(scope, {});
    String query = asString(queryValue)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto* database = access.database;
    access.actor->beginWrite(globalObject, database);
    RETURN_IF_EXCEPTION(scope, {});

    auto* realm = JSDurableObjectRealm::of(globalObject);
    auto* cursor = JSDurableObjectSqlCursor::create(vm, realm->structure(JSDurableObjectRealm::Field::CursorStructure), access.actor, nullptr);
    DurableObjectDatabase::UserScope restricted(*database);
    int changesBefore = sqlite3_total_changes(database->handle());

    // The bindings are for the last statement, and so is the cursor; those before it run to completion.
    sqlite3_stmt* prepared = database->takeCached(query);
    if (prepared)
        cursor->m_sql = query;
    else {
        CString utf8 = query.utf8();
        size_t offset = 0;
        bool single = true;
        for (;;) {
            sqlite3_stmt* next = nullptr;
            if (!database->prepareNext(utf8, offset, next)) {
                throwStorageError(globalObject, scope, database);
                return {};
            }
            if (!next)
                break;
            if (restIsBlank(utf8, offset)) {
                prepared = next;
                break;
            }
            single = false;
            int result;
            while ((result = sqlite3_step(next)) == SQLITE_ROW) { }
            if (result != SQLITE_DONE) {
                JSObject* error = createStorageError(globalObject, database);
                sqlite3_finalize(next);
                throwException(globalObject, scope, error);
                return {};
            }
            sqlite3_finalize(next);
        }
        if (!prepared) {
            throwException(globalObject, scope, createError(globalObject, "SQL query contained no statement"_s));
            return {};
        }
        if (single)
            cursor->m_sql = query;
    }
    cursor->m_statement = prepared;

    int expected = sqlite3_bind_parameter_count(prepared);
    int given = static_cast<int>(callFrame->argumentCount()) - 1;
    if (given < 0)
        given = 0;
    if (expected != given) {
        cursor->finish();
        throwException(globalObject, scope, createError(globalObject, makeString("Wrong number of parameter bindings for SQL query: expected "_s, expected, ", got "_s, given, '.')));
        return {};
    }
    for (int i = 0; i < given; i++) {
        if (!bindParameter(globalObject, scope, prepared, i + 1, callFrame->uncheckedArgument(static_cast<size_t>(i) + 1))) {
            cursor->finish();
            return {};
        }
    }
    cursor->setColumns(globalObject, scope);
    RETURN_IF_EXCEPTION(scope, {});
    cursor->advance(globalObject, scope);
    RETURN_IF_EXCEPTION(scope, {});
    cursor->m_rowsWritten = sqlite3_total_changes(database->handle()) - changesBefore;
    return JSValue::encode(cursor);
}

JSC_DEFINE_CUSTOM_GETTER(jsDurableObjectSqlDatabaseSize, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    StorageAccess access = accessStorage(globalObject, scope, JSValue::decode(thisValue), JSDurableObjectHandle::Kind::Sql, "SqlStorage"_s, "databaseSize"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsNumber(static_cast<double>(access.database->databaseSize())));
}

static JSDurableObjectSqlCursor* thisCursor(JSGlobalObject* globalObject, ThrowScope& scope, JSValue thisValue, ASCIILiteral method)
{
    auto* cursor = dynamicDowncast<JSDurableObjectSqlCursor>(thisValue);
    if (!cursor) [[unlikely]]
        WebCore::throwThisTypeError(*globalObject, scope, "SqlStorageCursor"_s, method);
    return cursor;
}

static JSObject* iteratorResult(Zig::GlobalObject* globalObject, bool done, JSValue value)
{
    return createIteratorResultObject(globalObject, value, done);
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectSqlCursorNext, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* cursor = thisCursor(globalObject, scope, callFrame->thisValue(), "next"_s);
    RETURN_IF_EXCEPTION(scope, {});
    auto* source = cursor->source();
    bool more = source->advance(globalObject, scope);
    RETURN_IF_EXCEPTION(scope, {});
    if (!more)
        return JSValue::encode(iteratorResult(globalObject, true, jsUndefined()));
    JSValue row = source->takeRow(globalObject, scope, cursor->isRaw());
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(iteratorResult(globalObject, false, row));
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectSqlCursorToArray, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* cursor = thisCursor(globalObject, scope, callFrame->thisValue(), "toArray"_s);
    RETURN_IF_EXCEPTION(scope, {});
    auto* source = cursor->source();
    MarkedArgumentBuffer rows;
    for (;;) {
        bool more = source->advance(globalObject, scope);
        RETURN_IF_EXCEPTION(scope, {});
        if (!more)
            break;
        rows.append(source->takeRow(globalObject, scope, cursor->isRaw()));
        RETURN_IF_EXCEPTION(scope, {});
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), rows)));
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectSqlCursorOne, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* cursor = thisCursor(globalObject, scope, callFrame->thisValue(), "one"_s);
    RETURN_IF_EXCEPTION(scope, {});
    auto* source = cursor->source();
    bool more = source->advance(globalObject, scope);
    RETURN_IF_EXCEPTION(scope, {});
    if (!more) {
        throwException(globalObject, scope, createError(globalObject, "Expected exactly one result from SQL query, but got no results."_s));
        return {};
    }
    JSValue row = source->takeRow(globalObject, scope, cursor->isRaw());
    RETURN_IF_EXCEPTION(scope, {});
    more = source->advance(globalObject, scope);
    RETURN_IF_EXCEPTION(scope, {});
    if (more) {
        source->finish();
        throwException(globalObject, scope, createError(globalObject, "Expected exactly one result from SQL query, but got multiple results."_s));
        return {};
    }
    return JSValue::encode(row);
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectSqlCursorRaw, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* cursor = thisCursor(globalObject, scope, callFrame->thisValue(), "raw"_s);
    RETURN_IF_EXCEPTION(scope, {});
    auto* realm = JSDurableObjectRealm::of(globalObject);
    auto* source = cursor->source();
    return JSValue::encode(JSDurableObjectSqlCursor::create(vm, realm->structure(JSDurableObjectRealm::Field::RawCursorStructure), source->m_actor.get(), source));
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectSqlCursorIterator, (JSGlobalObject*, CallFrame* callFrame))
{
    return JSValue::encode(callFrame->thisValue());
}

JSC_DEFINE_CUSTOM_GETTER(jsDurableObjectSqlCursorColumnNames, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* cursor = thisCursor(globalObject, scope, JSValue::decode(thisValue), "columnNames"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(cursor->source()->m_columnNames.get());
}

JSC_DEFINE_CUSTOM_GETTER(jsDurableObjectSqlCursorRowsRead, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* cursor = thisCursor(globalObject, scope, JSValue::decode(thisValue), "rowsRead"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsNumber(cursor->source()->m_rowsRead));
}

JSC_DEFINE_CUSTOM_GETTER(jsDurableObjectSqlCursorRowsWritten, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* cursor = thisCursor(globalObject, scope, JSValue::decode(thisValue), "rowsWritten"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsNumber(cursor->source()->m_rowsWritten));
}

// ─── Prototypes ──────────────────────────────────────────────────────────────

static const HashTableValue storagePrototypeValues[] = {
    { "get"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStorageGet, 1 } },
    { "list"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStorageList, 0 } },
    { "put"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStoragePut, 2 } },
    { "delete"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStorageDelete, 1 } },
    { "deleteAll"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStorageDeleteAll, 0 } },
    { "transaction"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStorageTransaction, 1 } },
    { "transactionSync"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStorageTransactionSync, 1 } },
    { "sync"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStorageSync, 0 } },
    { "getAlarm"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStorageGetAlarm, 0 } },
    { "setAlarm"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStorageSetAlarm, 1 } },
    { "deleteAlarm"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStorageDeleteAlarm, 0 } },
};

static const HashTableValue transactionPrototypeValues[] = {
    { "get"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectTransactionGet, 1 } },
    { "list"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectTransactionList, 0 } },
    { "put"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectTransactionPut, 2 } },
    { "delete"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectTransactionDelete, 1 } },
    { "rollback"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectTransactionRollback, 0 } },
    { "getAlarm"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectTransactionGetAlarm, 0 } },
    { "setAlarm"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectTransactionSetAlarm, 1 } },
    { "deleteAlarm"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectTransactionDeleteAlarm, 0 } },
};

static const HashTableValue kvPrototypeValues[] = {
    { "get"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectKvGet, 1 } },
    { "put"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectKvPut, 2 } },
    { "delete"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectKvDelete, 1 } },
    { "list"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectKvList, 0 } },
};

static const HashTableValue sqlPrototypeValues[] = {
    { "exec"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectSqlExec, 1 } },
    { "databaseSize"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDurableObjectSqlDatabaseSize, 0 } },
};

static const HashTableValue cursorPrototypeValues[] = {
    { "next"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectSqlCursorNext, 0 } },
    { "toArray"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectSqlCursorToArray, 0 } },
    { "one"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectSqlCursorOne, 0 } },
    { "raw"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectSqlCursorRaw, 0 } },
    { "columnNames"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDurableObjectSqlCursorColumnNames, 0 } },
    { "rowsRead"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDurableObjectSqlCursorRowsRead, 0 } },
    { "rowsWritten"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDurableObjectSqlCursorRowsWritten, 0 } },
};

static const HashTableValue rawCursorPrototypeValues[] = {
    { "next"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectSqlCursorNext, 0 } },
    { "toArray"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectSqlCursorToArray, 0 } },
};

template<size_t count>
static JSObject* createPrototype(VM& vm, JSGlobalObject* globalObject, const ClassInfo* info, const HashTableValue (&values)[count], ASCIILiteral tag)
{
    JSObject* prototype = constructEmptyObject(globalObject, globalObject->objectPrototype());
    reifyStaticProperties(vm, info, values, *prototype);
    prototype->putDirect(vm, vm.propertyNames->toStringTagSymbol, jsNontrivialString(vm, tag), PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly);
    return prototype;
}

JSObject* createDurableObjectStoragePrototype(VM& vm, JSGlobalObject* globalObject)
{
    return createPrototype(vm, globalObject, JSDurableObjectHandle::info(), storagePrototypeValues, "DurableObjectStorage"_s);
}

JSObject* createDurableObjectSqlPrototype(VM& vm, JSGlobalObject* globalObject)
{
    return createPrototype(vm, globalObject, JSDurableObjectHandle::info(), sqlPrototypeValues, "SqlStorage"_s);
}

JSObject* createDurableObjectKvPrototype(VM& vm, JSGlobalObject* globalObject)
{
    return createPrototype(vm, globalObject, JSDurableObjectHandle::info(), kvPrototypeValues, "SyncKvStorage"_s);
}

JSObject* createDurableObjectTransactionPrototype(VM& vm, JSGlobalObject* globalObject)
{
    return createPrototype(vm, globalObject, JSDurableObjectHandle::info(), transactionPrototypeValues, "DurableObjectTransaction"_s);
}

Structure* createDurableObjectCursorStructure(VM& vm, JSGlobalObject* globalObject, bool raw)
{
    JSObject* prototype = raw
        ? createPrototype(vm, globalObject, JSDurableObjectSqlCursor::info(), rawCursorPrototypeValues, "SqlStorageCursor"_s)
        : createPrototype(vm, globalObject, JSDurableObjectSqlCursor::info(), cursorPrototypeValues, "SqlStorageCursor"_s);
    prototype->putDirectNativeFunction(vm, globalObject, vm.propertyNames->iteratorSymbol, 0, jsDurableObjectSqlCursorIterator, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(PropertyAttribute::DontEnum));
    return JSDurableObjectSqlCursor::createStructure(vm, globalObject, prototype);
}

} // namespace Bun
