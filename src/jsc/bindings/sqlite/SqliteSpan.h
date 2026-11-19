#pragma once

#include "root.h"
#include "TelemetryBindings.h"

// bun_telemetry_jsc::NativeSpan: null if nothing is recorded.
extern "C" void* Bun__Telemetry__sqliteBegin(JSC::JSGlobalObject*, const char* file, const char* sql);
extern "C" void Bun__Telemetry__sqliteEnd(JSC::JSGlobalObject*, void* span);

namespace Bun {

// It has failed if an exception is pending where it ends.
class SqliteSpan {
    WTF_MAKE_NONCOPYABLE(SqliteSpan);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    ALWAYS_INLINE SqliteSpan(JSC::JSGlobalObject* globalObject, sqlite3* db, const char* sql)
        : m_globalObject(globalObject)
    {
        if (Telemetry::isEnabled(Bun__Telemetry__sqliteBit)) [[unlikely]]
            m_span = Bun__Telemetry__sqliteBegin(globalObject, sqlite3_db_filename(db, "main"), sql);
    }

    ALWAYS_INLINE SqliteSpan(JSC::JSGlobalObject* globalObject, sqlite3_stmt* statement)
        : m_globalObject(globalObject)
    {
        if (Telemetry::isEnabled(Bun__Telemetry__sqliteBit)) [[unlikely]]
            m_span = Bun__Telemetry__sqliteBegin(globalObject, sqlite3_db_filename(sqlite3_db_handle(statement), "main"), sqlite3_sql(statement));
    }

    ALWAYS_INLINE ~SqliteSpan()
    {
        if (m_span) [[unlikely]]
            Bun__Telemetry__sqliteEnd(m_globalObject, m_span);
    }

private:
    JSC::JSGlobalObject* m_globalObject;
    void* m_span { nullptr };
};

}
