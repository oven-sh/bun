#pragma once

#include "root.h"
#include <wtf/HashMap.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

struct sqlite3;
struct sqlite3_stmt;

namespace Bun {

// The SQLite database of one Durable Object: `ctx.storage`. Tables whose names start with
// `_cf_` are the runtime's (the key-value store and the alarm); SQL the object runs through
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
    String lastError() const;
    int lastErrorCode() const;

    // ── The implicit transaction ──
    bool inTransaction() const { return m_inTransaction; }
    unsigned depth() const { return m_depth; }
    // Opens the transaction if none is open.
    bool write();
    // Commits it, unless a transactionSync()/transaction() scope is open.
    bool flush();
    void rollback();
    bool beginScope();
    bool endScope(bool commit);
    // Set when the alarm was written since the last commit (the namespace's index follows it).
    bool m_alarmDirty { false };

    // ── Key-value ──
    enum class Lookup : uint8_t {
        Found,
        Missing,
        Failed,
    };
    Lookup kvGet(const String& key, Vector<uint8_t>& value);
    bool kvPut(const String& key, std::span<const uint8_t> value);
    // `existed` is set to whether there was such a key.
    bool kvDelete(const String& key, bool& existed);
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

    // ── Alarm ── (ms since the epoch)
    bool alarmTime(std::optional<int64_t>&);
    bool setAlarm(int64_t);
    bool deleteAlarm();

    // ── sql.exec() ──
    // The next statement of `sql` at `offset`, compiled under the restrictions above. `offset` is
    // moved past it. Null at the end of `sql`, or on failure (lastErrorCode() is then not SQLITE_OK).
    sqlite3_stmt* prepareNext(const CString& sql, size_t& offset);
    // A compiled copy of a whole one-statement `sql`, kept for the next exec() of the same text.
    sqlite3_stmt* takeCached(const String& sql);
    void giveBack(const String& sql, sqlite3_stmt*);
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
    int64_t databaseSize();

    // Closes the database; with `removeIfEmpty`, a file with nothing in it is deleted.
    void close(bool removeIfEmpty);

private:
    DurableObjectDatabase() = default;
    bool exec(const char* sql);
    sqlite3_stmt* statement(sqlite3_stmt*& slot, const char* sql);
    static int authorize(void*, int action, const char*, const char*, const char*, const char*);

    sqlite3* m_db { nullptr };
    String m_path;
    sqlite3_stmt* m_begin { nullptr };
    sqlite3_stmt* m_commit { nullptr };
    sqlite3_stmt* m_rollback { nullptr };
    sqlite3_stmt* m_kvGet { nullptr };
    sqlite3_stmt* m_kvPut { nullptr };
    sqlite3_stmt* m_kvDelete { nullptr };
    sqlite3_stmt* m_metaGet { nullptr };
    sqlite3_stmt* m_metaPut { nullptr };
    sqlite3_stmt* m_metaDelete { nullptr };
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
    bool isEmpty() { return !next(); }

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

} // namespace Bun
