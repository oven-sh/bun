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
#include "BunString.h"
#include "ErrorCode.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "JSDOMExceptionHandling.h"
#include "NodeValidator.h"
#include "PathInlines.h"
#include "SerializedScriptValue.h"
#include "ZigGlobalObject.h"
#include "helpers.h"

#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/DateInstance.h>
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
#include <JavaScriptCore/MicrotaskQueue.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/WeakInlines.h>
#include <wtf/SetForScope.h>
#include <wtf/text/StringBuilder.h>

extern "C" void Bun__initializeSQLite();
// 0, or an errno.
extern "C" int Bun__DurableObject__makeDirectory(const uint8_t* path, size_t length);
extern "C" void Bun__DurableObject__removeFile(const uint8_t* path, size_t length);

namespace Bun {
using namespace JSC;

static constexpr int metaAlarm = 1;
static constexpr int metaAlarmRetries = 2;
static constexpr size_t maxKeyBytes = 2048;
static constexpr unsigned maxCachedStatements = 64;

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

static int bindText(sqlite3_stmt* statement, int index, std::span<const uint8_t> utf8)
{
    return sqlite3_bind_text64(statement, index, reinterpret_cast<const char*>(utf8.data()), utf8.size(), SQLITE_STATIC, SQLITE_UTF8);
}

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
        database->m_sawAlterTable = true;
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
    SetForScope unrestricted(m_restricted, false);
    return sqlite3_exec(m_db, sql, nullptr, nullptr, nullptr) == SQLITE_OK;
}

sqlite3_stmt* DurableObjectDatabase::statement(sqlite3_stmt*& slot, const char* sql)
{
    if (!slot) {
        SetForScope unrestricted(m_restricted, false);
        sqlite3_prepare_v3(m_db, sql, -1, SQLITE_PREPARE_PERSISTENT, &slot, nullptr);
    }
    return slot;
}

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
    error = makeString("Could not create the Durable Object storage directory "_s, path, ": "_s, String::fromLatin1(Bun__errnoName(result)));
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
    abandonOpenStatements();
    rollback();
    bool remove = removeIfEmpty && !m_path.isNull() && isEmpty();
    for (sqlite3_stmt** slot : { &m_begin, &m_commit, &m_kvGet, &m_kvPut, &m_kvDelete, &m_metaGet, &m_metaPut, &m_metaDelete }) {
        if (*slot)
            sqlite3_finalize(*slot);
        *slot = nullptr;
    }
    for (auto& entry : m_cache)
        sqlite3_finalize(entry.value);
    m_cache.clear();
    for (auto& entry : m_listStatements)
        sqlite3_finalize(entry.value);
    m_listStatements.clear();
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
    if (m_inTransaction) {
        // SQLite rolls a transaction back by itself when the disk is full or a write fails.
        return !sqlite3_get_autocommit(m_db);
    }
    sqlite3_stmt* begin = statement(m_begin, "BEGIN");
    bool ok = begin && sqlite3_step(begin) == SQLITE_DONE;
    if (begin)
        sqlite3_reset(begin);
    m_inTransaction = ok;
    return ok;
}

bool DurableObjectDatabase::flush()
{
    if (!m_inTransaction || m_depth)
        return true;
    m_inTransaction = false;
    if (sqlite3_get_autocommit(m_db))
        return false;
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
    m_inTransaction = false;
    if (!sqlite3_get_autocommit(m_db))
        exec("ROLLBACK");
}

bool DurableObjectDatabase::beginScope(unsigned& level)
{
    if (!write())
        return false;
    level = m_depth;
    if (!exec(makeString("SAVEPOINT _cf_scope"_s, level).utf8().data()))
        return false;
    m_depth = level + 1;
    return true;
}

bool DurableObjectDatabase::endScope(unsigned level, bool commit)
{
    if (level >= m_depth)
        return true;
    m_depth = level;
    bool ok = true;
    if (!commit)
        ok = exec(makeString("ROLLBACK TO _cf_scope"_s, level).utf8().data());
    return exec(makeString("RELEASE _cf_scope"_s, level).utf8().data()) && ok;
}

DurableObjectDatabase::Lookup DurableObjectDatabase::kvGet(std::span<const uint8_t> key, Vector<uint8_t>& value)
{
    sqlite3_stmt* get = statement(m_kvGet, "SELECT value FROM _cf_KV WHERE key = ?");
    if (!get)
        return Lookup::Failed;
    StatementReset reset(get);
    bindText(get, 1, key);
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

bool DurableObjectDatabase::kvPut(std::span<const uint8_t> key, std::span<const uint8_t> value)
{
    sqlite3_stmt* put = statement(m_kvPut, "INSERT INTO _cf_KV (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
    if (!put)
        return false;
    StatementReset reset(put);
    bindText(put, 1, key);
    sqlite3_bind_blob64(put, 2, value.data(), value.size(), SQLITE_STATIC);
    return sqlite3_step(put) == SQLITE_DONE;
}

bool DurableObjectDatabase::kvDelete(std::span<const uint8_t> key, bool& existed)
{
    sqlite3_stmt* del = statement(m_kvDelete, "DELETE FROM _cf_KV WHERE key = ?");
    if (!del)
        return false;
    StatementReset reset(del);
    bindText(del, 1, key);
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
    enum Shape : unsigned {
        Start = 1,
        StartAfter = 2,
        End = 4,
        PrefixFrom = 8,
        PrefixTo = 16,
        Reverse = 32,
        Limit = 64,
    };
    unsigned shape = 0;
    Vector<CString, 5> bound;
    auto bind = [&](Shape bit, const String& value) {
        shape |= bit;
        bound.append(value.utf8());
    };
    if (!options.start.isNull())
        bind(Start, options.start);
    if (!options.startAfter.isNull())
        bind(StartAfter, options.startAfter);
    if (!options.end.isNull())
        bind(End, options.end);
    if (!options.prefix.isEmpty()) {
        bind(PrefixFrom, options.prefix);
        String after = prefixSuccessor(options.prefix);
        if (!after.isNull())
            bind(PrefixTo, after);
    }
    if (options.reverse)
        shape |= Reverse;
    if (options.limit >= 0)
        shape |= Limit;

    sqlite3_stmt* list = m_listStatements.get(shape);
    if (!list) {
        StringBuilder sql;
        sql.append("SELECT key, value FROM _cf_KV"_s);
        bool first = true;
        auto where = [&](Shape bit, ASCIILiteral comparison) {
            if (!(shape & bit))
                return;
            sql.append(first ? " WHERE "_s : " AND "_s, comparison);
            first = false;
        };
        where(Start, "key >= ?"_s);
        where(StartAfter, "key > ?"_s);
        where(End, "key < ?"_s);
        where(PrefixFrom, "key >= ?"_s);
        where(PrefixTo, "key < ?"_s);
        sql.append(shape & Reverse ? " ORDER BY key DESC"_s : " ORDER BY key"_s);
        if (shape & Limit)
            sql.append(" LIMIT ?"_s);
        CString utf8 = sql.toString().utf8();
        SetForScope unrestricted(m_restricted, false);
        if (sqlite3_prepare_v3(m_db, utf8.data(), static_cast<int>(utf8.length()), SQLITE_PREPARE_PERSISTENT, &list, nullptr) != SQLITE_OK)
            return false;
        m_listStatements.add(shape, list);
    }
    StatementReset reset(list);
    int index = 1;
    for (auto& value : bound)
        bindText(list, index++, byteCast<uint8_t>(value.span()));
    if (shape & Limit)
        sqlite3_bind_int64(list, index, options.limit);
    for (;;) {
        int result = sqlite3_step(list);
        if (result == SQLITE_DONE)
            return true;
        if (result != SQLITE_ROW)
            return false;
        const void* blob = sqlite3_column_blob(list, 1);
        size_t length = static_cast<size_t>(sqlite3_column_bytes(list, 1));
        if (!row(columnText(list, 0), std::span { static_cast<const uint8_t*>(blob), length }))
            return true;
    }
}

bool DurableObjectDatabase::deleteAll()
{
    if (!exec("DELETE FROM _cf_KV") || !exec("DELETE FROM _cf_METADATA"))
        return false;
    m_alarmDirty = true;
    exec("PRAGMA defer_foreign_keys = ON");
    // (A virtual table goes before the shadow tables it owns, which go with it.)
    struct Pass {
        ASCIILiteral kind;
        ASCIILiteral select;
    };
    for (auto pass : { Pass { "TRIGGER"_s, "type = 'trigger'"_s }, Pass { "VIEW"_s, "type = 'view'"_s }, Pass { "TABLE"_s, "type = 'table' AND sql LIKE 'CREATE VIRTUAL%'"_s }, Pass { "TABLE"_s, "type = 'table'"_s } }) {
        Vector<String> names;
        sqlite3_stmt* select = nullptr;
        CString query = makeString("SELECT name FROM sqlite_master WHERE "_s, pass.select, " AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'"_s).utf8();
        {
            SetForScope unrestricted(m_restricted, false);
            if (sqlite3_prepare_v2(m_db, query.data(), -1, &select, nullptr) != SQLITE_OK)
                return false;
        }
        while (sqlite3_step(select) == SQLITE_ROW)
            names.append(columnText(select, 0));
        sqlite3_finalize(select);
        for (auto& name : names) {
            String drop = makeString("DROP "_s, pass.kind, " IF EXISTS \""_s, makeStringByReplacingAll(name, "\""_s, "\"\""_s), '"');
            if (!exec(drop.utf8().data()))
                return false;
        }
    }
    exec("DELETE FROM sqlite_sequence");
    for (auto& entry : m_cache)
        sqlite3_finalize(entry.value);
    m_cache.clear();
    return true;
}

bool DurableObjectDatabase::isEmpty()
{
    SetForScope unrestricted(m_restricted, false);
    for (auto sql : { "SELECT 1 FROM _cf_KV LIMIT 1", "SELECT 1 FROM _cf_METADATA LIMIT 1", "SELECT 1 FROM sqlite_master WHERE name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' LIMIT 1" }) {
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

bool DurableObjectDatabase::metaGet(int key, std::optional<int64_t>& value)
{
    sqlite3_stmt* get = statement(m_metaGet, "SELECT value FROM _cf_METADATA WHERE key = ?");
    if (!get)
        return false;
    StatementReset reset(get);
    sqlite3_bind_int(get, 1, key);
    int result = sqlite3_step(get);
    if (result == SQLITE_ROW)
        value = sqlite3_column_int64(get, 0);
    else
        value = std::nullopt;
    return result == SQLITE_ROW || result == SQLITE_DONE;
}

bool DurableObjectDatabase::metaPut(int key, int64_t value)
{
    sqlite3_stmt* put = statement(m_metaPut, "INSERT INTO _cf_METADATA (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
    if (!put)
        return false;
    StatementReset reset(put);
    sqlite3_bind_int(put, 1, key);
    sqlite3_bind_int64(put, 2, value);
    return sqlite3_step(put) == SQLITE_DONE;
}

bool DurableObjectDatabase::metaDelete(int key)
{
    sqlite3_stmt* del = statement(m_metaDelete, "DELETE FROM _cf_METADATA WHERE key = ?");
    if (!del)
        return false;
    StatementReset reset(del);
    sqlite3_bind_int(del, 1, key);
    return sqlite3_step(del) == SQLITE_DONE;
}

bool DurableObjectDatabase::alarmTime(std::optional<int64_t>& time)
{
    return metaGet(metaAlarm, time);
}

bool DurableObjectDatabase::setAlarm(int64_t time)
{
    m_alarmDirty = true;
    return metaPut(metaAlarm, time) && metaDelete(metaAlarmRetries);
}

bool DurableObjectDatabase::deleteAlarm()
{
    m_alarmDirty = true;
    return metaDelete(metaAlarm) && metaDelete(metaAlarmRetries);
}

unsigned DurableObjectDatabase::alarmRetries()
{
    std::optional<int64_t> retries;
    return metaGet(metaAlarmRetries, retries) && retries ? static_cast<unsigned>(*retries) : 0;
}

void DurableObjectDatabase::setAlarmRetries(unsigned retries)
{
    if (retries)
        metaPut(metaAlarmRetries, retries);
    else
        metaDelete(metaAlarmRetries);
}

bool DurableObjectDatabase::prepareNext(std::span<const char> sql, size_t& offset, sqlite3_stmt*& prepared)
{
    prepared = nullptr;
    while (offset < sql.size() && !prepared) {
        const char* head = sql.data() + offset;
        const char* tail = nullptr;
        if (sqlite3_prepare_v3(m_db, head, static_cast<int>(sql.size() - offset), 0, &prepared, &tail) != SQLITE_OK)
            return false;
        offset = !tail || tail == head ? sql.size() : static_cast<size_t>(tail - sql.data());
    }
    return true;
}

// Whether nothing but white space, semicolons and comments is left of `sql` from `offset`.
static bool restIsBlank(std::span<const char> sql, size_t offset)
{
    const char* p = sql.data() + offset;
    const char* end = sql.data() + sql.size();
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

Ref<DurableObjectOpenStatement> DurableObjectDatabase::opened(sqlite3_stmt* prepared, const String& cacheKey, int changesBefore)
{
    Ref open = adoptRef(*new DurableObjectOpenStatement);
    open->statement = prepared;
    open->database = this;
    open->cacheKey = cacheKey;
    open->changesBefore = changesBefore;
    m_open.append(open.copyRef());
    return open;
}

void DurableObjectDatabase::letGo(DurableObjectOpenStatement& open, bool mayCache)
{
    sqlite3_stmt* prepared = std::exchange(open.statement, nullptr);
    if (!prepared)
        return;
    open.database = nullptr;
    m_open.removeFirstMatching([&](auto& entry) { return entry.ptr() == &open; });
    sqlite3_reset(prepared);
    open.changes = sqlite3_total_changes(m_db) - open.changesBefore;
    if (!mayCache || open.cacheKey.isNull() || m_cache.contains(open.cacheKey)) {
        sqlite3_finalize(prepared);
        return;
    }
    sqlite3_clear_bindings(prepared);
    if (m_cache.size() >= maxCachedStatements) {
        auto victim = m_cache.begin();
        sqlite3_finalize(victim->value);
        m_cache.remove(victim);
    }
    m_cache.add(open.cacheKey, prepared);
}

void DurableObjectDatabase::abandonOpenStatements()
{
    for (auto& open : std::exchange(m_open, {})) {
        if (sqlite3_stmt* prepared = std::exchange(open->statement, nullptr))
            sqlite3_finalize(prepared);
        open->database = nullptr;
    }
}

bool DurableObjectDatabase::hasReservedNames()
{
    SetForScope unrestricted(m_restricted, false);
    sqlite3_stmt* select = nullptr;
    if (sqlite3_prepare_v2(m_db, "SELECT 1 FROM sqlite_master WHERE name LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT IN ('_cf_KV', '_cf_METADATA') LIMIT 1", -1, &select, nullptr) != SQLITE_OK)
        return true;
    bool found = sqlite3_step(select) == SQLITE_ROW;
    sqlite3_finalize(select);
    return found;
}

int64_t DurableObjectDatabase::databaseSize()
{
    SetForScope unrestricted(m_restricted, false);
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
    bindText(prepared, 1, hex.span8());
    if (time)
        sqlite3_bind_int64(prepared, 2, *time);
    sqlite3_step(prepared);
}

void DurableObjectAlarmIndex::hint(const String& hex, int64_t time)
{
    StatementReset reset(m_hint);
    bindText(m_hint, 1, hex.span8());
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

static void throwStorageError(JSGlobalObject* globalObject, ThrowScope& scope, DurableObjectDatabase* database)
{
    throwException(globalObject, scope, createSQLiteErrorFor(globalObject, database->handle()));
}

DurableObjectDatabase* JSDurableObjectActor::database(Zig::GlobalObject* globalObject)
{
    if (m_database)
        return m_database.get();
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* owner = ns();
    String path = owner->storageDirectory().isNull() ? String() : durableObjectDatabasePath(owner->storageDirectory(), id()->hex()->tryGetValue());
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
    VM& vm = globalObject->vm();
    if (!database->write()) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (database->inTransaction())
            throwException(globalObject, scope, createError(globalObject, ErrorCode::ERR_SQLITE_ERROR, "SQLite rolled back what this Durable Object had written and not yet committed"_s));
        else
            throwStorageError(globalObject, scope, database);
        return false;
    }
    if (!m_commitScheduled && !database->depth()) {
        m_commitScheduled = true;
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
        JSObject* error = createError(globalObject, ErrorCode::ERR_DURABLE_OBJECT_RESET, "Durable Object storage could not be written; the object was reset"_s);
        error->putDirect(vm, vm.propertyNames->cause, createSQLiteErrorFor(globalObject, database->handle()), static_cast<unsigned>(PropertyAttribute::DontEnum));
        abort(globalObject, error);
        return false;
    }
    if (database->m_alarmDirty) {
        database->m_alarmDirty = false;
        alarmChanged();
    }
    return true;
}

// ─── Reaching the database from script ───────────────────────────────────────
//
// Arguments are read, and values serialized, before the database is asked for: both can run the
// object's script, which can reset the object, and the database goes with a reset.

struct StorageAccess {
    JSDurableObjectActor* actor { nullptr };
    DurableObjectDatabase* database { nullptr };
    explicit operator bool() const { return database; }
};

static StorageAccess accessStorage(Zig::GlobalObject* globalObject, ThrowScope& scope, JSValue thisValue, JSDurableObjectHandle::Kind kind, ASCIILiteral className, ASCIILiteral method)
{
    JSDurableObjectHandle* handle = toCurrentHandle(globalObject, scope, thisValue, kind, className, method);
    RETURN_IF_EXCEPTION(scope, {});
    auto* actor = handle->actor();
    auto* database = actor->database(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return { actor, database };
}

static bool hasLoneSurrogate(StringView view)
{
    if (view.is8Bit())
        return false;
    auto units = view.span16();
    for (size_t i = 0; i < units.size(); i++) {
        if (!U16_IS_SURROGATE(units[i]))
            continue;
        if (U16_IS_SURROGATE_LEAD(units[i]) && i + 1 < units.size() && U16_IS_TRAIL(units[i + 1])) {
            i++;
            continue;
        }
        return true;
    }
    return false;
}

// A key, as the string script gave and as the bytes the database compares.
struct StorageKey {
    String string;
    std::optional<UTF8View> utf8;
    std::span<const uint8_t> bytes() const { return utf8->bytes(); }
};

static bool readKey(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral name, StorageKey& key)
{
    if (!value.isString()) {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "string"_s, value);
        return false;
    }
    key.string = asString(value)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    if (key.string.length() <= maxKeyBytes) {
        if (hasLoneSurrogate(key.string)) {
            Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, name, value, "must be well-formed Unicode"_s);
            return false;
        }
        key.utf8 = UTF8View::tryCreate(globalObject, scope, key.string);
        RETURN_IF_EXCEPTION(scope, false);
        if (key.bytes().size() <= maxKeyBytes)
            return true;
    }
    Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, name, jsString(globalObject->vm(), makeString(StringView(key.string).left(32), "..."_s)), makeString("must be at most "_s, maxKeyBytes, " bytes"_s));
    return false;
}

static bool readKeys(Zig::GlobalObject* globalObject, ThrowScope& scope, JSValue value, Vector<StorageKey>& keys)
{
    if (!isArray(globalObject, value)) {
        RETURN_IF_EXCEPTION(scope, false);
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "key"_s, "string or Array"_s, value);
        return false;
    }
    forEachInArrayLike(globalObject, asObject(value), [&](JSValue element) {
        StorageKey key;
        if (!readKey(globalObject, scope, element, "key"_s, key))
            return false;
        keys.append(WTF::move(key));
        return true;
    });
    return !scope.exception();
}

static RefPtr<WebCore::SerializedScriptValue> serializeValue(Zig::GlobalObject* globalObject, ThrowScope& scope, JSValue value)
{
    if (value.isUndefined()) {
        Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "value"_s, value, "cannot be undefined"_s);
        return nullptr;
    }
    RefPtr serialized = WebCore::SerializedScriptValue::create(*globalObject, value, WebCore::SerializationForStorage::Yes, WebCore::SerializationErrorMode::Throwing);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!serialized)
        throwTypeError(globalObject, scope, "This value cannot be stored: it cannot be cloned"_s);
    return serialized;
}

static JSValue deserializeValue(Zig::GlobalObject* globalObject, ThrowScope& scope, Vector<uint8_t>&& bytes)
{
    auto serialized = WebCore::SerializedScriptValue::createFromWireBytes(WTF::move(bytes));
    RELEASE_AND_RETURN(scope, serialized->deserialize(*globalObject, globalObject, WebCore::SerializationErrorMode::Throwing));
}

static JSValue kvGet(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access, const StorageKey& key)
{
    Vector<uint8_t> bytes;
    switch (access.database->kvGet(key.bytes(), bytes)) {
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

static void kvPut(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access, const StorageKey& key, std::span<const uint8_t> value)
{
    access.actor->beginWrite(globalObject, access.database);
    RETURN_IF_EXCEPTION(scope, );
    if (!access.database->kvPut(key.bytes(), value))
        throwStorageError(globalObject, scope, access.database);
}

static bool kvDelete(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access, const StorageKey& key)
{
    access.actor->beginWrite(globalObject, access.database);
    RETURN_IF_EXCEPTION(scope, false);
    bool existed = false;
    if (!access.database->kvDelete(key.bytes(), existed))
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
    auto readBound = [&](ASCIILiteral name, ASCIILiteral argumentName, String& out) {
        JSValue property = object->get(globalObject, Identifier::fromString(vm, name));
        RETURN_IF_EXCEPTION(scope, false);
        if (property.isUndefined())
            return true;
        StorageKey key;
        if (!readKey(globalObject, scope, property, argumentName, key))
            return false;
        out = key.string;
        return true;
    };
    if (!readBound("start"_s, "options.start"_s, options.start) || !readBound("startAfter"_s, "options.startAfter"_s, options.startAfter)
        || !readBound("end"_s, "options.end"_s, options.end) || !readBound("prefix"_s, "options.prefix"_s, options.prefix))
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
static void kvList(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access, const DurableObjectDatabase::ListOptions& options, const Function<void(JSString*, JSValue)>& each)
{
    VM& vm = globalObject->vm();
    bool ok = access.database->kvList(options, [&](String&& key, std::span<const uint8_t> bytes) {
        JSValue value = deserializeValue(globalObject, scope, Vector<uint8_t>(bytes));
        RETURN_IF_EXCEPTION(scope, false);
        each(jsString(vm, WTF::move(key)), value);
        return !scope.exception();
    });
    if (!ok && !scope.exception())
        throwStorageError(globalObject, scope, access.database);
}

// Runs `body` inside a savepoint: what it wrote stays only if it returns true.
static bool inScope(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access, const Function<bool()>& body)
{
    access.actor->beginWrite(globalObject, access.database);
    RETURN_IF_EXCEPTION(scope, false);
    unsigned level = 0;
    if (!access.database->beginScope(level)) {
        throwStorageError(globalObject, scope, access.database);
        return false;
    }
    uint32_t generation = access.actor->generation();
    bool ok = body();
    // Reset inside the scope: it went with the database.
    if (access.actor->generation() != generation)
        return false;
    if (!access.database->endScope(level, ok) && ok) {
        if (!scope.exception())
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

// The asynchronous API answers with promises that are already settled: SQLite is synchronous,
// and the object is not interleaved with other events while it awaits them (JSDurableObjectActor::enqueue).
static EncodedJSValue settled(Zig::GlobalObject* globalObject, ThrowScope& scope, JSValue value)
{
    if (scope.exception()) [[unlikely]]
        return JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(globalObject, scope));
    RELEASE_AND_RETURN(scope, JSValue::encode(JSPromise::resolvedPromise(globalObject, value)));
}

#define STORAGE_FUNCTION_PROLOGUE()                                 \
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);  \
    VM& vm = globalObject->vm();                                    \
    auto scope = DECLARE_THROW_SCOPE(vm);                           \
    (void)vm;

#define STORAGE_ACCESS(kind, className, method)                                                                                                       \
    StorageAccess access = accessStorage(globalObject, scope, callFrame->thisValue(), JSDurableObjectHandle::Kind::kind, className, method);          \
    if (!access) [[unlikely]]                                                                                                                          \
        return settled(globalObject, scope, {});

// ── get / list ──

static JSValue getMany(Zig::GlobalObject* globalObject, ThrowScope& scope, Vector<StorageKey>& keys, const Function<JSValue(const StorageKey&)>& get)
{
    VM& vm = globalObject->vm();
    std::sort(keys.begin(), keys.end(), [](const StorageKey& a, const StorageKey& b) { return codePointCompare(a.string, b.string) < 0; });
    JSMap* map = JSMap::create(vm, globalObject->mapStructure());
    for (auto& key : keys) {
        JSValue value = get(key);
        RETURN_IF_EXCEPTION(scope, {});
        if (value.isUndefined())
            continue;
        map->set(globalObject, jsString(vm, key.string), value);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return map;
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStorageGet, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    JSValue keysValue = callFrame->argument(0);
    if (keysValue.isString()) {
        StorageKey key;
        if (!readKey(globalObject, scope, keysValue, "key"_s, key))
            return settled(globalObject, scope, {});
        STORAGE_ACCESS(Storage, "DurableObjectStorage"_s, "get"_s)
        JSValue value = kvGet(globalObject, scope, access, key);
        return settled(globalObject, scope, value);
    }
    Vector<StorageKey> keys;
    if (!readKeys(globalObject, scope, keysValue, keys))
        return settled(globalObject, scope, {});
    STORAGE_ACCESS(Storage, "DurableObjectStorage"_s, "get"_s)
    JSValue map = getMany(globalObject, scope, keys, [&](const StorageKey& key) { return kvGet(globalObject, scope, access, key); });
    return settled(globalObject, scope, map);
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStorageList, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    DurableObjectDatabase::ListOptions options;
    if (!readListOptions(globalObject, scope, callFrame->argument(0), options))
        return settled(globalObject, scope, {});
    STORAGE_ACCESS(Storage, "DurableObjectStorage"_s, "list"_s)
    JSMap* map = JSMap::create(vm, globalObject->mapStructure());
    kvList(globalObject, scope, access, options, [&](JSString* key, JSValue value) { map->set(globalObject, key, value); });
    return settled(globalObject, scope, map);
}

// ── put / delete ──

struct PendingPut {
    StorageKey key;
    RefPtr<WebCore::SerializedScriptValue> value;
};

// put(key, value) or put({ key: value, ... }): the keys checked and the values serialized.
static bool readPuts(Zig::GlobalObject* globalObject, ThrowScope& scope, JSValue keyOrEntries, JSValue value, Vector<PendingPut>& puts)
{
    VM& vm = globalObject->vm();
    if (keyOrEntries.isString()) {
        PendingPut put;
        if (!readKey(globalObject, scope, keyOrEntries, "key"_s, put.key))
            return false;
        put.value = serializeValue(globalObject, scope, value);
        RETURN_IF_EXCEPTION(scope, false);
        puts.append(WTF::move(put));
        return true;
    }
    if (!keyOrEntries.isObject()) {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "key"_s, "string or object"_s, keyOrEntries);
        return false;
    }
    JSObject* entries = asObject(keyOrEntries);
    PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    entries->methodTable()->getOwnPropertyNames(entries, globalObject, names, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, false);
    for (auto& name : names) {
        JSValue entry = entries->get(globalObject, name);
        RETURN_IF_EXCEPTION(scope, false);
        if (entry.isUndefined())
            continue;
        PendingPut put;
        if (!readKey(globalObject, scope, jsString(vm, name.string()), "key"_s, put.key))
            return false;
        put.value = serializeValue(globalObject, scope, entry);
        RETURN_IF_EXCEPTION(scope, false);
        puts.append(WTF::move(put));
    }
    return true;
}

static void putAll(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access, const Vector<PendingPut>& puts)
{
    if (puts.size() == 1) {
        kvPut(globalObject, scope, access, puts[0].key, puts[0].value->wireBytes().span());
        return;
    }
    inScope(globalObject, scope, access, [&] {
        for (auto& put : puts) {
            kvPut(globalObject, scope, access, put.key, put.value->wireBytes().span());
            RETURN_IF_EXCEPTION(scope, false);
        }
        return true;
    });
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStoragePut, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    Vector<PendingPut> puts;
    if (!readPuts(globalObject, scope, callFrame->argument(0), callFrame->argument(1), puts))
        return settled(globalObject, scope, {});
    STORAGE_ACCESS(Storage, "DurableObjectStorage"_s, "put"_s)
    putAll(globalObject, scope, access, puts);
    return settled(globalObject, scope, jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStorageDelete, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    JSValue keysValue = callFrame->argument(0);
    if (keysValue.isString()) {
        StorageKey key;
        if (!readKey(globalObject, scope, keysValue, "key"_s, key))
            return settled(globalObject, scope, {});
        STORAGE_ACCESS(Storage, "DurableObjectStorage"_s, "delete"_s)
        bool existed = kvDelete(globalObject, scope, access, key);
        return settled(globalObject, scope, jsBoolean(existed));
    }
    Vector<StorageKey> keys;
    if (!readKeys(globalObject, scope, keysValue, keys))
        return settled(globalObject, scope, {});
    STORAGE_ACCESS(Storage, "DurableObjectStorage"_s, "delete"_s)
    unsigned count = 0;
    inScope(globalObject, scope, access, [&] {
        for (auto& key : keys) {
            bool existed = kvDelete(globalObject, scope, access, key);
            RETURN_IF_EXCEPTION(scope, false);
            count += existed;
        }
        return true;
    });
    return settled(globalObject, scope, jsNumber(count));
}

// ── alarms ──

static bool readAlarmTime(JSGlobalObject* globalObject, ThrowScope& scope, JSValue scheduledTime, int64_t& when)
{
    double time;
    if (auto* date = dynamicDowncast<DateInstance>(scheduledTime))
        time = date->internalNumber();
    else if (scheduledTime.isNumber())
        time = scheduledTime.asNumber();
    else {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "scheduledTime"_s, "number or Date"_s, scheduledTime);
        return false;
    }
    if (!(time >= 0) || !std::isfinite(time) || time > static_cast<double>(maxSafeInteger())) {
        Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "scheduledTime"_s, scheduledTime, "must be a time in milliseconds since the epoch"_s);
        return false;
    }
    when = static_cast<int64_t>(std::floor(time));
    return true;
}

// setAlarm() needs a class that has an alarm() to call.
static bool requireAlarmHandler(Zig::GlobalObject* globalObject, ThrowScope& scope, JSValue thisValue)
{
    auto* handle = dynamicDowncast<JSDurableObjectHandle>(thisValue);
    JSObject* instance = handle ? handle->actor()->instance() : nullptr;
    if (!instance)
        return true;
    JSValue handler = instance->get(globalObject, Identifier::fromString(globalObject->vm(), "alarm"_s));
    RETURN_IF_EXCEPTION(scope, false);
    if (handler.isCallable())
        return true;
    throwTypeError(globalObject, scope, "This Durable Object class has no alarm() handler, which setAlarm() needs"_s);
    return false;
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

static void storageSetAlarm(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access, int64_t when)
{
    access.actor->beginWrite(globalObject, access.database);
    RETURN_IF_EXCEPTION(scope, );
    if (!access.database->setAlarm(when)) {
        throwStorageError(globalObject, scope, access.database);
        return;
    }
    if (access.actor->m_alarmRunning)
        access.actor->m_alarmTouched = true;
    // The namespace's timer hears of the time before it is committed; see DurableObjectAlarmIndex.
    auto* owner = access.actor->ns();
    owner->alarmIndex().hint(access.actor->id()->hex()->tryGetValue(), when);
    owner->scheduleAlarms();
    owner->updateKeepAlive();
}

static void storageDeleteAlarm(Zig::GlobalObject* globalObject, ThrowScope& scope, const StorageAccess& access)
{
    access.actor->beginWrite(globalObject, access.database);
    RETURN_IF_EXCEPTION(scope, );
    if (!access.database->deleteAlarm()) {
        throwStorageError(globalObject, scope, access.database);
        return;
    }
    if (access.actor->m_alarmRunning)
        access.actor->m_alarmTouched = true;
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStorageGetAlarm, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    STORAGE_ACCESS(Storage, "DurableObjectStorage"_s, "getAlarm"_s)
    JSValue time = storageGetAlarm(globalObject, scope, access);
    return settled(globalObject, scope, time);
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStorageSetAlarm, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    int64_t when = 0;
    if (!readAlarmTime(globalObject, scope, callFrame->argument(0), when) || !requireAlarmHandler(globalObject, scope, callFrame->thisValue()))
        return settled(globalObject, scope, {});
    STORAGE_ACCESS(Storage, "DurableObjectStorage"_s, "setAlarm"_s)
    storageSetAlarm(globalObject, scope, access, when);
    return settled(globalObject, scope, jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStorageDeleteAlarm, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    STORAGE_ACCESS(Storage, "DurableObjectStorage"_s, "deleteAlarm"_s)
    storageDeleteAlarm(globalObject, scope, access);
    return settled(globalObject, scope, jsUndefined());
}

// ── deleteAll / sync / transactionSync ──

static void drainOpenStatements(Zig::GlobalObject*, ThrowScope&, DurableObjectDatabase*);

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStorageDeleteAll, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    STORAGE_ACCESS(Storage, "DurableObjectStorage"_s, "deleteAll"_s)
    drainOpenStatements(globalObject, scope, access.database);
    if (scope.exception()) [[unlikely]]
        return settled(globalObject, scope, {});
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
    STORAGE_FUNCTION_PROLOGUE()
    STORAGE_ACCESS(Storage, "DurableObjectStorage"_s, "sync"_s)
    ModuleGraphContextScope context(access.actor->ns()->context());
    if (!access.actor->flush(globalObject))
        throwException(globalObject, scope, createDurableObjectResetError(globalObject));
    return settled(globalObject, scope, jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStorageTransactionSync, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    JSValue closure = callFrame->argument(0);
    V::validateFunction(scope, globalObject, closure, "closure"_s);
    RETURN_IF_EXCEPTION(scope, {});
    StorageAccess access = accessStorage(globalObject, scope, callFrame->thisValue(), JSDurableObjectHandle::Kind::Storage, "DurableObjectStorage"_s, "transactionSync"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue result;
    inScope(globalObject, scope, access, [&] {
        result = JSC::call(globalObject, closure, JSC::getCallData(closure), jsUndefined(), ArgList());
        return !scope.exception();
    });
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

// ─── storage.transaction() ───────────────────────────────────────────────────
//
// What the closure writes through `txn` is kept in memory and applied, all of it or none of it,
// when the closure's promise fulfils. Nothing is held open across the closure's awaits, so other
// events of the object are not in its way and it is not in theirs; it reads what is committed
// when it asks, overlaid with what it wrote itself.

static JSDurableObjectHandle* thisTransaction(Zig::GlobalObject* globalObject, ThrowScope& scope, JSValue thisValue, ASCIILiteral method)
{
    JSDurableObjectHandle* handle = toCurrentHandle(globalObject, scope, thisValue, JSDurableObjectHandle::Kind::Transaction, "DurableObjectTransaction"_s, method);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (handle->m_finished)
        Bun::ERR::INVALID_STATE(scope, globalObject, "This transaction has already finished"_s);
    else if (handle->m_rolledBack)
        Bun::ERR::INVALID_STATE(scope, globalObject, "This transaction was rolled back"_s);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return handle;
}

static JSMap* writesOf(JSDurableObjectHandle* transaction)
{
    return uncheckedDowncast<JSMap>(transaction->extra().asCell());
}

// What the transaction wrote for `key`: the serialized value, null for a delete, empty for nothing.
static JSValue writtenIn(Zig::GlobalObject* globalObject, JSDurableObjectHandle* transaction, const StorageKey& key)
{
    JSMap* writes = writesOf(transaction);
    JSString* name = jsString(globalObject->vm(), key.string);
    return writes->has(globalObject, name) ? writes->get(globalObject, name) : JSValue();
}

static JSValue transactionGet(Zig::GlobalObject* globalObject, ThrowScope& scope, JSDurableObjectHandle* transaction, const StorageAccess& access, const StorageKey& key)
{
    JSValue written = writtenIn(globalObject, transaction, key);
    RETURN_IF_EXCEPTION(scope, {});
    if (!written)
        RELEASE_AND_RETURN(scope, kvGet(globalObject, scope, access, key));
    if (written.isNull())
        return jsUndefined();
    auto* bytes = uncheckedDowncast<JSUint8Array>(written.asCell());
    RELEASE_AND_RETURN(scope, deserializeValue(globalObject, scope, Vector<uint8_t>(bytes->span())));
}

#define TRANSACTION_PROLOGUE(method)                                                                          \
    STORAGE_FUNCTION_PROLOGUE()                                                                               \
    JSDurableObjectHandle* transaction = thisTransaction(globalObject, scope, callFrame->thisValue(), method); \
    if (!transaction) [[unlikely]]                                                                            \
        return settled(globalObject, scope, {});

#define TRANSACTION_ACCESS()                                              \
    transaction = thisTransaction(globalObject, scope, callFrame->thisValue(), "get"_s); \
    if (!transaction) [[unlikely]]                                        \
        return settled(globalObject, scope, {});                          \
    StorageAccess access { transaction->actor(), transaction->actor()->database(globalObject) }; \
    if (!access) [[unlikely]]                                             \
        return settled(globalObject, scope, {});

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectTransactionGet, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    TRANSACTION_PROLOGUE("get"_s)
    JSValue keysValue = callFrame->argument(0);
    if (keysValue.isString()) {
        StorageKey key;
        if (!readKey(globalObject, scope, keysValue, "key"_s, key))
            return settled(globalObject, scope, {});
        TRANSACTION_ACCESS()
        JSValue value = transactionGet(globalObject, scope, transaction, access, key);
        return settled(globalObject, scope, value);
    }
    Vector<StorageKey> keys;
    if (!readKeys(globalObject, scope, keysValue, keys))
        return settled(globalObject, scope, {});
    TRANSACTION_ACCESS()
    JSValue map = getMany(globalObject, scope, keys, [&](const StorageKey& key) { return transactionGet(globalObject, scope, transaction, access, key); });
    return settled(globalObject, scope, map);
}

static bool keyIsSelected(const String& key, const DurableObjectDatabase::ListOptions& options)
{
    if (!options.start.isNull() && codePointCompare(key, options.start) < 0)
        return false;
    if (!options.startAfter.isNull() && codePointCompare(key, options.startAfter) <= 0)
        return false;
    if (!options.end.isNull() && codePointCompare(key, options.end) >= 0)
        return false;
    return options.prefix.isEmpty() || key.startsWith(options.prefix);
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectTransactionList, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    TRANSACTION_PROLOGUE("list"_s)
    DurableObjectDatabase::ListOptions options;
    if (!readListOptions(globalObject, scope, callFrame->argument(0), options))
        return settled(globalObject, scope, {});
    TRANSACTION_ACCESS()
    // What is committed, without the limit, then what the transaction wrote over it.
    struct Row {
        String key;
        JSValue value;
    };
    Vector<Row> rows;
    MarkedArgumentBuffer values;
    int64_t limit = std::exchange(options.limit, -1);
    JSMap* writes = writesOf(transaction);
    kvList(globalObject, scope, access, options, [&](JSString* key, JSValue value) {
        if (writes->has(globalObject, key))
            return;
        values.append(value);
        rows.append({ key->tryGetValue(), value });
    });
    if (scope.exception()) [[unlikely]]
        return settled(globalObject, scope, {});
    auto* iterator = JSMapIterator::create(vm, globalObject->mapIteratorStructure(), writes, IterationKind::Entries);
    JSValue writtenKey, written;
    while (iterator->nextKeyValue(globalObject, writtenKey, written)) {
        String key = asString(writtenKey)->tryGetValue();
        if (written.isNull() || !keyIsSelected(key, options))
            continue;
        JSValue value = deserializeValue(globalObject, scope, Vector<uint8_t>(uncheckedDowncast<JSUint8Array>(written.asCell())->span()));
        if (scope.exception()) [[unlikely]]
            return settled(globalObject, scope, {});
        values.append(value);
        rows.append({ key, value });
    }
    std::sort(rows.begin(), rows.end(), [&](const Row& a, const Row& b) {
        auto order = codePointCompare(a.key, b.key);
        return options.reverse ? order > 0 : order < 0;
    });
    JSMap* map = JSMap::create(vm, globalObject->mapStructure());
    for (auto& row : rows) {
        if (limit >= 0 && !limit--)
            break;
        map->set(globalObject, jsString(vm, row.key), row.value);
        if (scope.exception()) [[unlikely]]
            return settled(globalObject, scope, {});
    }
    return settled(globalObject, scope, map);
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectTransactionPut, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    TRANSACTION_PROLOGUE("put"_s)
    Vector<PendingPut> puts;
    if (!readPuts(globalObject, scope, callFrame->argument(0), callFrame->argument(1), puts))
        return settled(globalObject, scope, {});
    transaction = thisTransaction(globalObject, scope, callFrame->thisValue(), "put"_s);
    if (!transaction) [[unlikely]]
        return settled(globalObject, scope, {});
    JSMap* writes = writesOf(transaction);
    for (auto& put : puts) {
        auto bytes = put.value->wireBytes().span();
        auto* stored = JSUint8Array::createUninitialized(globalObject, globalObject->m_typedArrayUint8.get(globalObject), bytes.size());
        if (scope.exception()) [[unlikely]]
            return settled(globalObject, scope, {});
        memcpySpan(stored->typedSpan(), bytes);
        writes->set(globalObject, jsString(vm, put.key.string), stored);
        if (scope.exception()) [[unlikely]]
            return settled(globalObject, scope, {});
    }
    return settled(globalObject, scope, jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectTransactionDelete, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    TRANSACTION_PROLOGUE("delete"_s)
    JSValue keysValue = callFrame->argument(0);
    Vector<StorageKey> keys;
    bool single = keysValue.isString();
    if (single) {
        StorageKey key;
        if (!readKey(globalObject, scope, keysValue, "key"_s, key))
            return settled(globalObject, scope, {});
        keys.append(WTF::move(key));
    } else if (!readKeys(globalObject, scope, keysValue, keys))
        return settled(globalObject, scope, {});
    TRANSACTION_ACCESS()
    JSMap* writes = writesOf(transaction);
    unsigned count = 0;
    for (auto& key : keys) {
        JSValue written = writtenIn(globalObject, transaction, key);
        bool existed;
        if (written)
            existed = !written.isNull();
        else {
            Vector<uint8_t> unused;
            auto found = access.database->kvGet(key.bytes(), unused);
            if (found == DurableObjectDatabase::Lookup::Failed) {
                throwStorageError(globalObject, scope, access.database);
                return settled(globalObject, scope, {});
            }
            existed = found == DurableObjectDatabase::Lookup::Found;
        }
        count += existed;
        writes->set(globalObject, jsString(vm, key.string), jsNull());
        if (scope.exception()) [[unlikely]]
            return settled(globalObject, scope, {});
    }
    return settled(globalObject, scope, single ? jsBoolean(count) : jsNumber(count));
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectTransactionRollback, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    JSDurableObjectHandle* transaction = thisTransaction(globalObject, scope, callFrame->thisValue(), "rollback"_s);
    RETURN_IF_EXCEPTION(scope, {});
    transaction->m_rolledBack = true;
    return JSValue::encode(jsUndefined());
}

// The alarm the transaction means to leave behind: a time, null for none, empty when it did not say.
JSC_DEFINE_HOST_FUNCTION(jsDurableObjectTransactionGetAlarm, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    TRANSACTION_PROLOGUE("getAlarm"_s)
    if (!transaction->target().isUndefined())
        return settled(globalObject, scope, transaction->target());
    TRANSACTION_ACCESS()
    JSValue time = storageGetAlarm(globalObject, scope, access);
    return settled(globalObject, scope, time);
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectTransactionSetAlarm, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    TRANSACTION_PROLOGUE("setAlarm"_s)
    int64_t when = 0;
    if (!readAlarmTime(globalObject, scope, callFrame->argument(0), when) || !requireAlarmHandler(globalObject, scope, callFrame->thisValue()))
        return settled(globalObject, scope, {});
    transaction->setTarget(vm, jsNumber(static_cast<double>(when)));
    return settled(globalObject, scope, jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectTransactionDeleteAlarm, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    TRANSACTION_PROLOGUE("deleteAlarm"_s)
    transaction->setTarget(vm, jsNull());
    return settled(globalObject, scope, jsUndefined());
}

// The closure's promise settled: applies what the transaction wrote, and settles transaction()'s promise.
void finishDurableObjectTransaction(Zig::GlobalObject* globalObject, JSDurableObjectEvent* continuation, JSValue value, bool failed)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* transaction = uncheckedDowncast<JSDurableObjectHandle>(continuation->a());
    JSPromise* promise = continuation->promise();
    transaction->m_finished = true;
    if (failed) {
        promise->reject(vm, value);
        return;
    }
    if (transaction->m_rolledBack) {
        promise->resolve(globalObject, vm, value);
        return;
    }
    auto* actor = transaction->actor();
    if (!transaction->isCurrent()) {
        promise->reject(vm, createDurableObjectResetError(globalObject));
        return;
    }
    StorageAccess access { actor, actor->database(globalObject) };
    if (access) {
        JSMap* writes = writesOf(transaction);
        inScope(globalObject, scope, access, [&] {
            auto* iterator = JSMapIterator::create(vm, globalObject->mapIteratorStructure(), writes, IterationKind::Entries);
            JSValue writtenKey, written;
            while (iterator->nextKeyValue(globalObject, writtenKey, written)) {
                StorageKey key;
                key.string = asString(writtenKey)->tryGetValue();
                key.utf8 = UTF8View::tryCreate(globalObject, scope, key.string);
                RETURN_IF_EXCEPTION(scope, false);
                if (written.isNull())
                    kvDelete(globalObject, scope, access, key);
                else
                    kvPut(globalObject, scope, access, key, uncheckedDowncast<JSUint8Array>(written.asCell())->span());
                RETURN_IF_EXCEPTION(scope, false);
            }
            if (transaction->target().isNumber())
                storageSetAlarm(globalObject, scope, access, static_cast<int64_t>(transaction->target().asNumber()));
            else if (transaction->target().isNull())
                storageDeleteAlarm(globalObject, scope, access);
            return !scope.exception();
        });
    }
    if (auto* exception = scope.exception()) [[unlikely]] {
        JSValue error = exception->value();
        if (scope.tryClearException())
            promise->reject(vm, error);
        return;
    }
    promise->resolve(globalObject, vm, value);
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStorageTransaction, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    JSValue closure = callFrame->argument(0);
    V::validateFunction(scope, globalObject, closure, "closure"_s);
    if (scope.exception()) [[unlikely]]
        return settled(globalObject, scope, {});
    STORAGE_ACCESS(Storage, "DurableObjectStorage"_s, "transaction"_s)
    auto* realm = JSDurableObjectRealm::of(globalObject);
    auto* transaction = JSDurableObjectHandle::create(vm, realm->structure(JSDurableObjectRealm::Field::TransactionStructure), JSDurableObjectHandle::Kind::Transaction, access.actor);
    transaction->setExtra(vm, JSMap::create(vm, globalObject->mapStructure()));
    JSPromise* outer = JSPromise::create(vm, globalObject->promiseStructure());
    auto* continuation = JSDurableObjectEvent::create(vm, globalObject, DurableObjectEventKind::Transaction, access.actor, transaction, jsUndefined(), jsUndefined(), outer);

    MarkedArgumentBuffer arguments;
    arguments.append(transaction);
    JSValue result = JSC::call(globalObject, closure, JSC::getCallData(closure), jsUndefined(), arguments);
    JSPromise* awaited = nullptr;
    if (!scope.exception()) {
        awaited = dynamicDowncast<JSPromise>(result);
        if (!awaited)
            awaited = JSPromise::resolvedPromise(globalObject, result);
    }
    if (auto* exception = scope.exception()) [[unlikely]] {
        JSValue error = exception->value();
        if (!scope.tryClearException())
            return {};
        transaction->m_finished = true;
        outer->reject(vm, error);
        return JSValue::encode(outer);
    }
    ModuleGraphContextScope context(access.actor->ns()->context());
    awaited->performPromiseThenWithContext(vm, globalObject, realm->function(JSDurableObjectRealm::Field::OnFulfilled), realm->function(JSDurableObjectRealm::Field::OnRejected), jsUndefined(), continuation);
    return JSValue::encode(outer);
}

// ─── ctx.storage.kv ──────────────────────────────────────────────────────────

#define KV_ACCESS(method)                                                                                                                                    \
    StorageAccess access = accessStorage(globalObject, scope, callFrame->thisValue(), JSDurableObjectHandle::Kind::Kv, "DurableObjectStorage.kv"_s, method); \
    RETURN_IF_EXCEPTION(scope, {});

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectKvGet, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    StorageKey key;
    if (!readKey(globalObject, scope, callFrame->argument(0), "key"_s, key))
        return {};
    KV_ACCESS("get"_s)
    RELEASE_AND_RETURN(scope, JSValue::encode(kvGet(globalObject, scope, access, key)));
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectKvPut, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    StorageKey key;
    if (!readKey(globalObject, scope, callFrame->argument(0), "key"_s, key))
        return {};
    RefPtr value = serializeValue(globalObject, scope, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    KV_ACCESS("put"_s)
    kvPut(globalObject, scope, access, key, value->wireBytes().span());
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectKvDelete, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    StorageKey key;
    if (!readKey(globalObject, scope, callFrame->argument(0), "key"_s, key))
        return {};
    KV_ACCESS("delete"_s)
    bool existed = kvDelete(globalObject, scope, access, key);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(existed));
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectKvList, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    DurableObjectDatabase::ListOptions options;
    if (!readListOptions(globalObject, scope, callFrame->argument(0), options))
        return {};
    KV_ACCESS("list"_s)
    MarkedArgumentBuffer entries;
    kvList(globalObject, scope, access, options, [&](JSString* key, JSValue value) {
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

// What exec() returns. A statement that reads is stepped as the cursor is read, for as long as
// script holds the cursor; a statement that writes has run to its end before exec() returns, and
// the rows it returned wait in memory. Before another statement writes, every cursor still
// reading does the same, so that an open statement is never in the way of a DROP or a commit.
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
    static JSDurableObjectSqlCursor* create(VM& vm, Structure* structure, JSDurableObjectSqlCursor* source)
    {
        auto* cursor = new (NotNull, allocateCell<JSDurableObjectSqlCursor>(vm)) JSDurableObjectSqlCursor(vm, structure);
        cursor->finishCreation(vm);
        if (source)
            cursor->m_source.set(vm, cursor, source);
        return cursor;
    }
    static void destroy(JSCell* cell) { static_cast<JSDurableObjectSqlCursor*>(cell)->~JSDurableObjectSqlCursor(); }
    ~JSDurableObjectSqlCursor()
    {
        if (m_open && m_open->database)
            m_open->database->letGo(*m_open, false);
    }

    // raw(): the same rows, as arrays. Reads through to the cursor it was made from.
    JSDurableObjectSqlCursor* source() { return m_source ? m_source.get() : this; }
    bool isRaw() const { return !!m_source; }

    void open(VM& vm, Ref<DurableObjectOpenStatement>&& statement)
    {
        m_open = WTF::move(statement);
        m_open->cursor = JSC::Weak<JSDurableObjectSqlCursor>(this);
        (void)vm;
    }
    sqlite3_stmt* statement() const { return m_open ? m_open->statement : nullptr; }

    // Lets go of the statement: nothing more will be read from it.
    void close(bool mayCache)
    {
        m_hasRow = false;
        m_done = true;
        if (m_open && m_open->database)
            m_open->database->letGo(*m_open, mayCache);
    }

    // Makes the next row ready. False at the end, or with an exception thrown.
    bool advance(Zig::GlobalObject* globalObject, ThrowScope& scope)
    {
        if (m_hasRow)
            return true;
        if (JSArray* buffer = m_buffer.get()) {
            if (m_bufferIndex < buffer->length())
                return m_hasRow = true;
            m_buffer.clear();
            m_done = true;
        }
        if (m_done)
            return false;
        if (!statement()) {
            // The object was evicted or reset with rows unread: they went with its database.
            m_done = true;
            throwException(globalObject, scope, createDurableObjectResetError(globalObject));
            return false;
        }
        auto* database = m_open->database;
        int result;
        {
            DurableObjectDatabase::UserScope restricted(*database);
            result = sqlite3_step(statement());
        }
        if (result == SQLITE_ROW) {
            m_rowsRead++;
            return m_hasRow = true;
        }
        if (result != SQLITE_DONE) {
            JSValue error = createSQLiteErrorFor(globalObject, database->handle());
            close(false);
            throwException(globalObject, scope, error);
            return false;
        }
        close(true);
        return false;
    }

    // The row that is ready, consumed.
    JSValue takeRow(Zig::GlobalObject* globalObject, ThrowScope& scope, bool raw)
    {
        VM& vm = globalObject->vm();
        MarkedArgumentBuffer values;
        if (JSArray* buffer = m_buffer.get()) {
            JSArray* row = uncheckedDowncast<JSArray>(buffer->getIndexQuickly(m_bufferIndex++));
            m_hasRow = false;
            if (raw)
                return row;
            for (unsigned i = 0, length = row->length(); i < length; i++)
                values.append(row->getIndexQuickly(i));
        } else {
            int count = sqlite3_column_count(statement());
            for (int i = 0; i < count; i++) {
                values.append(column(globalObject, scope, i));
                RETURN_IF_EXCEPTION(scope, {});
            }
            m_hasRow = false;
            if (raw)
                RELEASE_AND_RETURN(scope, constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), values));
        }
        if (Structure* structure = m_rowStructure.get()) {
            JSObject* row = constructEmptyObject(vm, structure);
            for (unsigned i = 0; i < values.size(); i++)
                row->putDirectOffset(vm, i, values.at(i));
            return row;
        }
        // Too many columns for inline storage, two with one name (the later one wins), or a name that is an index.
        JSObject* row = constructEmptyObject(globalObject);
        JSArray* names = m_columnNames.get();
        for (unsigned i = 0; i < values.size(); i++) {
            auto name = asString(names->getIndexQuickly(i))->toIdentifier(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            row->putDirectMayBeIndex(globalObject, name, values.at(i));
            RETURN_IF_EXCEPTION(scope, {});
        }
        return row;
    }

    // Reads what is left into memory and lets go of the statement.
    void drain(Zig::GlobalObject* globalObject, ThrowScope& scope)
    {
        if (!statement())
            return;
        VM& vm = globalObject->vm();
        MarkedArgumentBuffer rows;
        for (;;) {
            bool more = advance(globalObject, scope);
            RETURN_IF_EXCEPTION(scope, );
            if (!more)
                break;
            rows.append(takeRow(globalObject, scope, true));
            RETURN_IF_EXCEPTION(scope, );
        }
        if (rows.isEmpty())
            return;
        JSArray* buffer = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), rows);
        RETURN_IF_EXCEPTION(scope, );
        m_buffer.set(vm, this, buffer);
        m_bufferIndex = 0;
        m_done = false;
    }

    void setColumns(Zig::GlobalObject* globalObject, ThrowScope& scope)
    {
        VM& vm = globalObject->vm();
        int count = sqlite3_column_count(statement());
        MarkedArgumentBuffer names;
        Vector<Identifier> identifiers;
        bool plain = count && static_cast<unsigned>(count) <= JSFinalObject::maxInlineCapacity;
        for (int i = 0; i < count; i++) {
            const char* name = sqlite3_column_name(statement(), i);
            String string = name ? String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const unsigned char*>(name), strlen(name) }) : emptyString();
            auto identifier = Identifier::fromString(vm, string);
            plain = plain && !identifiers.contains(identifier) && !parseIndex(identifier);
            identifiers.append(identifier);
            names.append(jsString(vm, string));
        }
        JSArray* array = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), names);
        RETURN_IF_EXCEPTION(scope, );
        m_columnNames.set(vm, this, array);
        if (!plain)
            return;
        Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), count);
        for (int i = 0; i < count; i++) {
            PropertyOffset offset;
            structure = Structure::addPropertyTransition(vm, structure, identifiers[i], 0, offset);
        }
        m_rowStructure.set(vm, this, structure);
    }

    double rowsRead() const { return m_rowsRead; }
    double rowsWritten() const
    {
        if (!m_open)
            return 0;
        if (m_open->database && m_open->statement)
            return sqlite3_total_changes(m_open->database->handle()) - m_open->changesBefore;
        return m_open->changes;
    }
    JSArray* columnNames() const { return m_columnNames.get(); }

private:
    JSDurableObjectSqlCursor(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }

    JSValue column(Zig::GlobalObject* globalObject, ThrowScope& scope, int index)
    {
        VM& vm = globalObject->vm();
        sqlite3_stmt* prepared = statement();
        switch (sqlite3_column_type(prepared, index)) {
        case SQLITE_INTEGER:
            return jsNumber(static_cast<double>(sqlite3_column_int64(prepared, index)));
        case SQLITE_FLOAT:
            return jsDoubleNumber(sqlite3_column_double(prepared, index));
        case SQLITE_TEXT:
            return jsString(vm, columnText(prepared, index));
        case SQLITE_BLOB: {
            size_t length = static_cast<size_t>(sqlite3_column_bytes(prepared, index));
            auto* bytes = JSUint8Array::createUninitialized(globalObject, globalObject->m_typedArrayUint8.get(globalObject), length);
            RETURN_IF_EXCEPTION(scope, {});
            if (length)
                memcpy(bytes->typedVector(), sqlite3_column_blob(prepared, index), length);
            return bytes;
        }
        default:
            return jsNull();
        }
    }

    RefPtr<DurableObjectOpenStatement> m_open;
    // The statement has a row that was not read yet.
    bool m_hasRow { false };
    bool m_done { false };
    unsigned m_bufferIndex { 0 };
    double m_rowsRead { 0 };
    WriteBarrier<JSDurableObjectSqlCursor> m_source;
    WriteBarrier<JSArray> m_columnNames;
    WriteBarrier<Structure> m_rowStructure;
    // The rows read ahead by drain(), each an array of column values.
    WriteBarrier<JSArray> m_buffer;
};

const ClassInfo JSDurableObjectSqlCursor::s_info = { "SqlStorageCursor"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDurableObjectSqlCursor) };

template<typename Visitor>
void JSDurableObjectSqlCursor::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSDurableObjectSqlCursor>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_source);
    visitor.append(thisObject->m_columnNames);
    visitor.append(thisObject->m_rowStructure);
    visitor.append(thisObject->m_buffer);
}
DEFINE_VISIT_CHILDREN(JSDurableObjectSqlCursor);

// Every statement that is still open stops reading: its cursor takes the rest of its rows into
// memory, or, when the cursor has been collected, the statement is simply let go of.
static void drainOpenStatements(Zig::GlobalObject* globalObject, ThrowScope& scope, DurableObjectDatabase* database)
{
    if (database->m_open.isEmpty()) [[likely]]
        return;
    MarkedArgumentBuffer cursors;
    for (auto& open : Vector<Ref<DurableObjectOpenStatement>>(database->m_open)) {
        if (auto* cursor = open->cursor.get())
            cursors.append(cursor);
        else
            database->letGo(open.get(), false);
    }
    for (unsigned i = 0; i < cursors.size(); i++) {
        uncheckedDowncast<JSDurableObjectSqlCursor>(cursors.at(i).asCell())->drain(globalObject, scope);
        RETURN_IF_EXCEPTION(scope, );
    }
}

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
        double number = value.asNumber();
        if (number == std::trunc(number) && std::abs(number) <= static_cast<double>(maxSafeInteger()))
            sqlite3_bind_int64(prepared, index, static_cast<int64_t>(number));
        else
            sqlite3_bind_double(prepared, index, number);
        return true;
    }
    if (value.isBoolean()) {
        sqlite3_bind_int(prepared, index, value.asBoolean());
        return true;
    }
    if (value.isString()) {
        auto view = asString(value)->view(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        auto utf8 = UTF8View::tryCreate(globalObject, scope, view);
        RETURN_IF_EXCEPTION(scope, false);
        sqlite3_bind_text64(prepared, index, utf8->span().data(), utf8->span().size(), SQLITE_TRANSIENT, SQLITE_UTF8);
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

static JSObject* createNotAuthorizedError(Zig::GlobalObject* globalObject, ASCIILiteral message)
{
    VM& vm = globalObject->vm();
    JSObject* error = createError(globalObject, String(message));
    error->putDirect(vm, vm.propertyNames->name, jsString(vm, String("SQLiteError"_s)), static_cast<unsigned>(PropertyAttribute::DontEnum));
    error->putDirect(vm, WebCore::builtinNames(vm).codePublicName(), jsString(vm, String("SQLITE_AUTH"_s)), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    error->putDirect(vm, WebCore::builtinNames(vm).errnoPublicName(), jsNumber(SQLITE_AUTH), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    return error;
}

// exec(query, ...bindings). With several statements the bindings and the cursor are the last
// one's; those before it run to their end first, and if any of them fails none of them happened.
JSC_DEFINE_HOST_FUNCTION(jsDurableObjectSqlExec, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    JSValue queryValue = callFrame->argument(0);
    V::validateString(scope, globalObject, queryValue, "query"_s);
    RETURN_IF_EXCEPTION(scope, {});
    String query = asString(queryValue)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    StorageAccess access = accessStorage(globalObject, scope, callFrame->thisValue(), JSDurableObjectHandle::Kind::Sql, "SqlStorage"_s, "exec"_s);
    RETURN_IF_EXCEPTION(scope, {});
    auto* database = access.database;
    auto* actor = access.actor;

    auto* realm = JSDurableObjectRealm::of(globalObject);
    auto* cursor = JSDurableObjectSqlCursor::create(vm, realm->structure(JSDurableObjectRealm::Field::CursorStructure), nullptr);
    DurableObjectDatabase::UserScope restricted(*database);
    int changesBefore = sqlite3_total_changes(database->handle());

    // A script is all or nothing. So is a statement that renames a table: what it renamed it to is only known afterwards.
    std::optional<unsigned> scopeLevel;
    auto openScope = [&] {
        if (scopeLevel)
            return true;
        actor->beginWrite(globalObject, database);
        RETURN_IF_EXCEPTION(scope, false);
        unsigned level = 0;
        if (!database->beginScope(level)) {
            throwStorageError(globalObject, scope, database);
            return false;
        }
        scopeLevel = level;
        return true;
    };
    auto closeScope = [&](bool commit) {
        if (auto level = std::exchange(scopeLevel, std::nullopt))
            database->endScope(*level, commit);
    };
    // Before a statement that writes is stepped.
    auto aboutToWrite = [&](sqlite3_stmt* prepared) {
        if (sqlite3_stmt_readonly(prepared))
            return true;
        drainOpenStatements(globalObject, scope, database);
        RETURN_IF_EXCEPTION(scope, false);
        actor->beginWrite(globalObject, database);
        return !scope.exception();
    };

    sqlite3_stmt* prepared = database->takeCached(query);
    String cacheKey = prepared ? query : String();
    database->m_sawAlterTable = false;
    if (!prepared) {
        auto utf8 = UTF8View::tryCreate(globalObject, scope, query);
        RETURN_IF_EXCEPTION(scope, {});
        auto sql = utf8->span();
        size_t offset = 0;
        bool single = true;
        for (;;) {
            sqlite3_stmt* next = nullptr;
            if (!database->prepareNext(sql, offset, next)) {
                JSValue error = createSQLiteErrorFor(globalObject, database->handle());
                closeScope(false);
                throwException(globalObject, scope, error);
                return {};
            }
            if (!next)
                break;
            if (restIsBlank(sql, offset)) {
                prepared = next;
                break;
            }
            single = false;
            JSValue error;
            if (sqlite3_bind_parameter_count(next))
                error = createError(globalObject, "Only the last statement of a query can have parameter bindings"_s);
            else if (openScope() && aboutToWrite(next)) {
                int result;
                while ((result = sqlite3_step(next)) == SQLITE_ROW) { }
                if (result != SQLITE_DONE)
                    error = createSQLiteErrorFor(globalObject, database->handle());
            }
            sqlite3_finalize(next);
            if (error || scope.exception()) {
                closeScope(false);
                if (error)
                    throwException(globalObject, scope, error);
                return {};
            }
        }
        if (!prepared) {
            closeScope(false);
            throwException(globalObject, scope, createError(globalObject, "SQL query contained no statement"_s));
            return {};
        }
        if (single && !database->m_sawAlterTable)
            cacheKey = query;
    }
    cursor->open(vm, database->opened(prepared, cacheKey, changesBefore));
    auto fail = [&] {
        cursor->close(false);
        closeScope(false);
        return EncodedJSValue {};
    };

    int expected = sqlite3_bind_parameter_count(prepared);
    int given = std::max(0, static_cast<int>(callFrame->argumentCount()) - 1);
    if (expected != given) {
        throwException(globalObject, scope, createError(globalObject, makeString("Wrong number of parameter bindings for SQL query: expected "_s, expected, ", got "_s, given, '.')));
        return fail();
    }
    for (int i = 0; i < given; i++) {
        if (!bindParameter(globalObject, scope, prepared, i + 1, callFrame->uncheckedArgument(static_cast<size_t>(i) + 1)))
            return fail();
    }
    if (sqlite3_column_count(prepared)) {
        cursor->setColumns(globalObject, scope);
        if (scope.exception()) [[unlikely]]
            return fail();
    }
    bool writes = !sqlite3_stmt_readonly(prepared);
    if (writes) {
        // (The cursor being opened is not one of those to finish first.)
        Ref own = database->m_open.takeLast();
        bool ready = aboutToWrite(prepared);
        database->m_open.append(WTF::move(own));
        if (!ready)
            return fail();
    }
    bool renames = database->m_sawAlterTable;
    if (renames && !openScope())
        return fail();
    cursor->advance(globalObject, scope);
    if (scope.exception()) [[unlikely]]
        return fail();
    if (writes) {
        // A statement that writes is never left half run: what it returns waits in memory.
        cursor->drain(globalObject, scope);
        if (scope.exception()) [[unlikely]]
            return fail();
    }
    if (renames && database->hasReservedNames()) {
        throwException(globalObject, scope, createNotAuthorizedError(globalObject, "not authorized: names that start with _cf_ are reserved"_s));
        return fail();
    }
    if (scopeLevel) {
        closeScope(true);
        // A scope keeps the commit from being scheduled; it is now.
        actor->beginWrite(globalObject, database);
        RETURN_IF_EXCEPTION(scope, {});
    }
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

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectSqlCursorNext, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    auto* cursor = thisCursor(globalObject, scope, callFrame->thisValue(), "next"_s);
    RETURN_IF_EXCEPTION(scope, {});
    auto* source = cursor->source();
    bool more = source->advance(globalObject, scope);
    RETURN_IF_EXCEPTION(scope, {});
    if (!more)
        return JSValue::encode(createIteratorResultObject(globalObject, jsUndefined(), true));
    JSValue row = source->takeRow(globalObject, scope, cursor->isRaw());
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(createIteratorResultObject(globalObject, row, false));
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectSqlCursorToArray, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
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
    STORAGE_FUNCTION_PROLOGUE()
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
        source->close(true);
        throwException(globalObject, scope, createError(globalObject, "Expected exactly one result from SQL query, but got multiple results."_s));
        return {};
    }
    return JSValue::encode(row);
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectSqlCursorRaw, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    STORAGE_FUNCTION_PROLOGUE()
    auto* cursor = thisCursor(globalObject, scope, callFrame->thisValue(), "raw"_s);
    RETURN_IF_EXCEPTION(scope, {});
    auto* realm = JSDurableObjectRealm::of(globalObject);
    return JSValue::encode(JSDurableObjectSqlCursor::create(vm, realm->structure(JSDurableObjectRealm::Field::RawCursorStructure), cursor->source()));
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
    if (JSArray* names = cursor->source()->columnNames())
        return JSValue::encode(names);
    RELEASE_AND_RETURN(scope, JSValue::encode(constructEmptyArray(globalObject, nullptr)));
}

JSC_DEFINE_CUSTOM_GETTER(jsDurableObjectSqlCursorRowsRead, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* cursor = thisCursor(globalObject, scope, JSValue::decode(thisValue), "rowsRead"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsNumber(cursor->source()->rowsRead()));
}

JSC_DEFINE_CUSTOM_GETTER(jsDurableObjectSqlCursorRowsWritten, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* cursor = thisCursor(globalObject, scope, JSValue::decode(thisValue), "rowsWritten"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsNumber(cursor->source()->rowsWritten()));
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

JSObject* createDurableObjectStoragePrototype(VM& vm, JSGlobalObject* globalObject)
{
    return createDurableObjectPrototype(vm, globalObject, JSDurableObjectHandle::info(), storagePrototypeValues, "DurableObjectStorage"_s);
}

JSObject* createDurableObjectSqlPrototype(VM& vm, JSGlobalObject* globalObject)
{
    return createDurableObjectPrototype(vm, globalObject, JSDurableObjectHandle::info(), sqlPrototypeValues, "SqlStorage"_s);
}

JSObject* createDurableObjectKvPrototype(VM& vm, JSGlobalObject* globalObject)
{
    return createDurableObjectPrototype(vm, globalObject, JSDurableObjectHandle::info(), kvPrototypeValues, "SyncKvStorage"_s);
}

JSObject* createDurableObjectTransactionPrototype(VM& vm, JSGlobalObject* globalObject)
{
    return createDurableObjectPrototype(vm, globalObject, JSDurableObjectHandle::info(), transactionPrototypeValues, "DurableObjectTransaction"_s);
}

Structure* createDurableObjectCursorStructure(VM& vm, JSGlobalObject* globalObject, bool raw)
{
    JSObject* prototype = raw
        ? createDurableObjectPrototype(vm, globalObject, JSDurableObjectSqlCursor::info(), rawCursorPrototypeValues, "SqlStorageCursor"_s)
        : createDurableObjectPrototype(vm, globalObject, JSDurableObjectSqlCursor::info(), cursorPrototypeValues, "SqlStorageCursor"_s);
    prototype->putDirectNativeFunction(vm, globalObject, vm.propertyNames->iteratorSymbol, 0, jsDurableObjectSqlCursorIterator, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(PropertyAttribute::DontEnum));
    return JSDurableObjectSqlCursor::createStructure(vm, globalObject, prototype);
}

} // namespace Bun
