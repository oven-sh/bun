#pragma once

#include "root.h"
#include <JavaScriptCore/Weak.h>
#include <wtf/HashMap.h>
#include <wtf/RefCounted.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

struct sqlite3;
struct sqlite3_stmt;

namespace Bun {

class DurableObjectDatabase;
class JSDurableObjectSqlCursor;

// A statement sql.exec() compiled that has not run to its end. The cursor reading it and the
// database both hold it: the database has to be able to finish it (before another statement
// writes) or give it up (when it closes) whether or not the cursor has been collected.
struct DurableObjectOpenStatement : public RefCounted<DurableObjectOpenStatement> {
    // Null once it has been let go of.
    sqlite3_stmt* statement { nullptr };
    // Null once the database closed or was reset under it: what was not read is gone.
    DurableObjectDatabase* database { nullptr };
    // The text exec() was given, when the whole of it is this one statement.
    String cacheKey;
    JSC::Weak<JSDurableObjectSqlCursor> cursor;
    int changesBefore { 0 };
    int changes { 0 };
};

// The SQLite database of one Durable Object: `ctx.storage`. Tables whose names start with
// `_cf_` are the runtime's (the key-value store, the alarm); SQL the object runs through
// `sql.exec()` cannot name them, cannot control transactions and cannot attach databases.
//
// Writes made without an `await` in between are one transaction: the first write of a
// synchronous run opens it (write()), a microtask commits it, and nothing the object says
// leaves before that commit (JSDurableObjectActor::flush).
class DurableObjectDatabase {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(DurableObjectDatabase);
    WTF_MAKE_NONCOPYABLE(DurableObjectDatabase);

public:
    // `path` null: in memory. Null with `error` set on failure.
    static std::unique_ptr<DurableObjectDatabase> open(const String& path, String& error);
    ~DurableObjectDatabase();

    sqlite3* handle() const { return m_db; }
    bool isInMemory() const { return m_path.isNull(); }

    // ── The implicit transaction ──
    bool inTransaction() const { return m_inTransaction; }
    unsigned depth() const { return m_depth; }
    // Opens the transaction if none is open. False when that fails, or when SQLite gave up the
    // transaction by itself (the disk is full, say) and what was written in it is gone.
    bool write();
    // Commits it, unless a scope is open.
    bool flush();
    void rollback();
    // A scope is a savepoint: what was written inside one that ends with `commit` false is undone.
    // `level` names it, so that ending an outer scope ends the ones inside it too.
    bool beginScope(unsigned& level);
    bool endScope(unsigned level, bool commit);
    // Set when the alarm was written since the last commit (the namespace's index follows it).
    bool m_alarmDirty { false };

    // ── Key-value ──
    enum class Lookup : uint8_t {
        Found,
        Missing,
        Failed,
    };
    Lookup kvGet(std::span<const uint8_t> key, Vector<uint8_t>& value);
    bool kvPut(std::span<const uint8_t> key, std::span<const uint8_t> value);
    // `existed` is set to whether there was such a key.
    bool kvDelete(std::span<const uint8_t> key, bool& existed);
    struct ListOptions {
        String start;
        String startAfter;
        String end;
        String prefix;
        bool reverse { false };
        int64_t limit { -1 };
    };
    // Calls `row` with each key and the bytes of its value, in key order, until it returns false.
    bool kvList(const ListOptions&, const Function<bool(String&&, std::span<const uint8_t>)>& row);
    // Everything the object stored: the key-value store, the alarm, and what it made with SQL.
    bool deleteAll();
    // Nothing is stored: the file need not exist.
    bool isEmpty();

    // ── Alarm ── (ms since the epoch; how many times in a row its handler has failed)
    bool alarmTime(std::optional<int64_t>&);
    bool setAlarm(int64_t);
    bool deleteAlarm();
    unsigned alarmRetries();
    void setAlarmRetries(unsigned);

    // ── sql.exec() ──
    // The next statement of `sql` at `offset`, compiled under the restrictions above. `offset` is
    // moved past it. `prepared` is null at the end of `sql`. False on failure.
    bool prepareNext(std::span<const char> sql, size_t& offset, sqlite3_stmt*& prepared);
    // A compiled copy of a whole one-statement `sql`, kept for the next exec() of the same text.
    sqlite3_stmt* takeCached(const String& sql);
    // Statements that have not run to their end. See DurableObjectOpenStatement.
    Vector<Ref<DurableObjectOpenStatement>> m_open;
    Ref<DurableObjectOpenStatement> opened(sqlite3_stmt*, const String& cacheKey, int changesBefore);
    // Resets the statement and keeps it for the next exec() of the same text, or finalizes it.
    void letGo(DurableObjectOpenStatement&, bool mayCache);
    void abandonOpenStatements();
    // While alive, statements are compiled and stepped under the restrictions above.
    class UserScope {
    public:
        explicit UserScope(DurableObjectDatabase& database)
            : m_database(database)
            , m_previous(database.m_restricted)
        {
            database.m_restricted = true;
        }
        ~UserScope() { m_database.m_restricted = m_previous; }

    private:
        DurableObjectDatabase& m_database;
        bool m_previous;
    };
    // Set by the authorizer when the statement being compiled is an ALTER TABLE.
    bool m_sawAlterTable { false };
    // Whether something other than the runtime's tables has a reserved name.
    bool hasReservedNames();
    int64_t databaseSize();

    // Closes the database; with `removeIfEmpty`, a file with nothing in it is deleted.
    void close(bool removeIfEmpty);

private:
    DurableObjectDatabase() = default;
    bool exec(const char* sql);
    sqlite3_stmt* statement(sqlite3_stmt*& slot, const char* sql);
    bool metaGet(int key, std::optional<int64_t>&);
    bool metaPut(int key, int64_t);
    bool metaDelete(int key);
    static int authorize(void*, int action, const char*, const char*, const char*, const char*);

    sqlite3* m_db { nullptr };
    String m_path;
    sqlite3_stmt* m_begin { nullptr };
    sqlite3_stmt* m_commit { nullptr };
    sqlite3_stmt* m_kvGet { nullptr };
    sqlite3_stmt* m_kvPut { nullptr };
    sqlite3_stmt* m_kvDelete { nullptr };
    sqlite3_stmt* m_metaGet { nullptr };
    sqlite3_stmt* m_metaPut { nullptr };
    sqlite3_stmt* m_metaDelete { nullptr };
    // The statements of list(), one per combination of options. Never where exec() looks: they
    // were compiled without its restrictions.
    HashMap<unsigned, sqlite3_stmt*, WTF::IntHash<unsigned>, WTF::UnsignedWithZeroKeyHashTraits<unsigned>> m_listStatements;
    HashMap<String, sqlite3_stmt*> m_cache;
    unsigned m_depth { 0 };
    bool m_inTransaction { false };
    bool m_restricted { false };
};

// The namespace's index of its objects' alarms. A hint, not the record: the object's own
// database says whether an alarm is set. An entry is written before the object's transaction
// commits and corrected after, so the index may name an object whose alarm is later or gone
// (the object is asked when the entry comes due), never miss one that is set.
class DurableObjectAlarmIndex {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(DurableObjectAlarmIndex);
    WTF_MAKE_NONCOPYABLE(DurableObjectAlarmIndex);

public:
    // `directory` null: in memory. Null with `error` set on failure; `inUse` when the failure is
    // that another namespace (in this process or another) has the directory.
    static std::unique_ptr<DurableObjectAlarmIndex> open(const String& directory, String& error, bool& inUse);
    ~DurableObjectAlarmIndex();

    void set(const String& hex, std::optional<int64_t> time);
    // Only ever makes the entry earlier.
    void hint(const String& hex, int64_t time);
    std::optional<int64_t> next();
    Vector<String> due(int64_t now);

private:
    DurableObjectAlarmIndex() = default;
    sqlite3* m_db { nullptr };
    sqlite3_stmt* m_set { nullptr };
    sqlite3_stmt* m_hint { nullptr };
    sqlite3_stmt* m_delete { nullptr };
    sqlite3_stmt* m_next { nullptr };
    sqlite3_stmt* m_due { nullptr };
};

String durableObjectDatabasePath(const String& directory, const String& hex);
// bun:sqlite's SQLiteError for the last failure on `db` (JSSQLStatement.cpp).
JSC::JSValue createSQLiteErrorFor(JSC::JSGlobalObject*, sqlite3* db);

} // namespace Bun
