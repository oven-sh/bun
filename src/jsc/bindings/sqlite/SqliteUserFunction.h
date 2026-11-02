#pragma once

// It calls SQLite, so include it after the SQLite header of the module (lazy_sqlite3.h on macOS).

#include "root.h"
#include "SqliteColumnNames.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/StrongInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/TypedArrayInlines.h>
#include <span>
#include <wtf/SetForScope.h>

// JSSQLStatement.cpp: the one-time sqlite3_config() calls of the process.
extern "C" void Bun__initializeSQLite();

namespace Bun {

// Before the first sqlite3_open_v2() of a call. False with an exception pending.
inline bool loadSQLite(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope)
{
#if LAZY_LOAD_SQLITE
    WTF::String message;
    if (lazyLoadSQLite(&message) < 0) [[unlikely]] {
        scope.throwException(globalObject, JSC::createError(globalObject, message));
        return false;
    }
#endif
    Bun__initializeSQLite();
    return true;
}

// SQLite TEXT / column names / errmsg can carry non-UTF-8 bytes (a Latin-1
// blob CAST to TEXT, a column aliased with such a string). WTF::String::
// fromUTF8 returns a NULL string on any invalid byte and jsString(null) then
// yields "" — the drift #31514 fixed for bun:sqlite. Decode with U+FFFD
// replacement everywhere we surface SQLite-owned bytes to JS.
ALWAYS_INLINE WTF::String sqliteText(const char* p, size_t len)
{
    return WTF::String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const uint8_t*>(p), len });
}
ALWAYS_INLINE WTF::String sqliteText(const char* p)
{
    return p ? sqliteText(p, strlen(p)) : WTF::String();
}

// A copy of the bytes. Null with an exception pending.
inline JSC::JSUint8Array* sqliteBytes(JSC::JSGlobalObject* globalObject, const void* bytes, size_t length)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    auto* array = JSC::JSUint8Array::createUninitialized(globalObject, globalObject->m_typedArrayUint8.get(globalObject), length);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (length)
        memcpy(array->typedVector(), bytes, length);
    return array;
}

// Throws `RangeError: Out of memory` for a string too long to convert, where utf8() aborts.
inline WTF::UTF8CString tryUTF8(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, const WTF::String& string)
{
    auto utf8 = string.tryGetUTF8();
    if (!utf8) [[unlikely]] {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    return WTF::move(*utf8);
}

inline bool SqliteColumnNames::changed(sqlite3_stmt* stmt)
{
    if (!sqlite3_stmt_status(stmt, SQLITE_STMTSTATUS_REPREPARE, 1) && !m_bytes.isEmpty())
        return false;
    WTF::Vector<char, 512> bytes;
    for (int i = 0, count = sqlite3_column_count(stmt); i < count; ++i) {
        const char* name = sqlite3_column_name(stmt, i);
        if (!name)
            name = "";
        bytes.append(std::span { name, strlen(name) + 1 });
    }
    if (bytes == m_bytes)
        return false;
    m_bytes = bytes;
    return true;
}

// True if resetting or finalizing `stmt` commits a write that iterate() stopped on a row. At that commit, a full-text
// index writes to its own tables with statements that call the connection's update hook and authorizer.
inline bool sqliteCommitsWhenFinalized(sqlite3_stmt* stmt)
{
    return sqlite3_stmt_busy(stmt) && !sqlite3_stmt_readonly(stmt);
}

// JS can't run during GC or at process exit, and the cells a callback reads can be dead. While this is set, a user
// function fails, the authorizer denies and the update hook isn't called. They check it before anything else.
inline thread_local bool sqliteScriptIsForbidden = false;

inline void sqliteFinalize(sqlite3_stmt* stmt, bool mayCallScript)
{
    WTF::SetForScope forbidScript { sqliteScriptIsForbidden, !mayCallScript };
    sqlite3_finalize(stmt);
}

// The statement that called the function fails, so a commit that needs it is rolled back.
inline bool sqliteFailsIfScriptIsForbidden(sqlite3_context* context)
{
    if (!sqliteScriptIsForbidden) [[likely]]
        return false;
    sqlite3_result_error(context, "", 0);
    return true;
}

// Where an SQL value comes from: a column of the current row, or an argument of a user function.
struct SqliteColumn {
    sqlite3_stmt* statement;
    int index;

    int type() const { return sqlite3_column_type(statement, index); }
    int64_t int64() const { return sqlite3_column_int64(statement, index); }
    double real() const { return sqlite3_column_double(statement, index); }
    size_t bytes() const { return sqlite3_column_bytes(statement, index); }
    const unsigned char* text() const { return sqlite3_column_text(statement, index); }
    const void* blob() const { return sqlite3_column_blob(statement, index); }
};

struct SqliteArgument {
    sqlite3_value* value;

    int type() const { return sqlite3_value_type(value); }
    int64_t int64() const { return sqlite3_value_int64(value); }
    double real() const { return sqlite3_value_double(value); }
    size_t bytes() const { return sqlite3_value_bytes(value); }
    const unsigned char* text() const { return sqlite3_value_text(value); }
    const void* blob() const { return sqlite3_value_blob(value); }
};

// Where an SQL value goes: a parameter of a statement, or the result of a user function.
// SQLITE_TRANSIENT: script can free the memory before sqlite3_step(). A null pointer (a detached buffer) would bind NULL, so "" stands in for it.
struct SqliteParameter {
    sqlite3_stmt* statement;
    int index;

    int null() const { return sqlite3_bind_null(statement, index); }
    int int64(int64_t value) const { return sqlite3_bind_int64(statement, index, value); }
    int real(double value) const { return sqlite3_bind_double(statement, index, value); }
    int text(std::span<const char> utf8) const { return sqlite3_bind_text64(statement, index, utf8.data(), utf8.size(), SQLITE_TRANSIENT, SQLITE_UTF8); }
    int blob(std::span<const uint8_t> bytes) const { return sqlite3_bind_blob64(statement, index, bytes.data() ? static_cast<const void*>(bytes.data()) : "", bytes.size(), SQLITE_TRANSIENT); }
};

// SQLite keeps a failure (SQLITE_TOOBIG) in the context, and sqlite3_step() returns it.
struct SqliteResult {
    sqlite3_context* context;

    int null() const { return sqlite3_result_null(context), SQLITE_OK; }
    int int64(int64_t value) const { return sqlite3_result_int64(context, value), SQLITE_OK; }
    int real(double value) const { return sqlite3_result_double(context, value), SQLITE_OK; }
    int text(std::span<const char> utf8) const { return sqlite3_result_text64(context, utf8.data(), utf8.size(), SQLITE_TRANSIENT, SQLITE_UTF8), SQLITE_OK; }
    int blob(std::span<const uint8_t> bytes) const { return sqlite3_result_blob64(context, bytes.data() ? static_cast<const void*>(bytes.data()) : "", bytes.size(), SQLITE_TRANSIENT), SQLITE_OK; }
};

// `Module` is what differs between bun:sqlite (SQLiteCallbacks) and node:sqlite (NodeSqliteCallbacks).
// The callbacks are plain pointers: the caller puts them in the SqliteCallbackRoots of its database cell once create() returned SQLITE_OK.
// xDestroy also runs when create() fails, and during a sweep (the destructor of a cell closes the connection), so it touches nothing of the collector.
// What a callback throws stays pending on the VM: whoever called sqlite3_step() looks for it before SQLite's result code.
// TopExceptionScope: a ThrowScope's destructor simulates a throw, which the next call in the same sqlite3_step() would report under validateExceptionChecks.

template<typename Module>
JSC::JSValue callSqliteCallback(const Module& module, JSC::JSObject* callback, JSC::JSValue thisValue, const JSC::ArgList& arguments)
{
    typename Module::CallbackScope callbackScope { module };
    return JSC::call(module.globalObject, callback, JSC::getCallData(callback), thisValue, arguments);
}

template<typename Module>
bool appendSqliteArguments(const Module& module, JSC::TopExceptionScope& scope, JSC::MarkedArgumentBuffer& arguments, int argc, sqlite3_value** argv)
{
    for (int i = 0; i < argc; i++) {
        JSC::JSValue value = module.toJS(argv[i]);
        if (scope.exception()) [[unlikely]]
            return false;
        arguments.append(value);
    }
    return true;
}

template<typename Module>
struct SqliteUserFunction {
    WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(SqliteUserFunction);

    Module module;
    JSC::JSObject* callback;

    static int create(sqlite3* db, const char* name, int argumentCount, int flags, Module&& module, JSC::JSObject* callback)
    {
        return sqlite3_create_function_v2(db, name, argumentCount, flags, new SqliteUserFunction { WTF::move(module), callback }, xFunc, nullptr, nullptr, xDestroy);
    }

private:
    static void xFunc(sqlite3_context* context, int argc, sqlite3_value** argv)
    {
        if (sqliteFailsIfScriptIsForbidden(context)) [[unlikely]]
            return;
        auto* self = static_cast<SqliteUserFunction*>(sqlite3_user_data(context));
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(JSC::getVM(self->module.globalObject));

        JSC::MarkedArgumentBuffer arguments;
        arguments.ensureCapacity(argc);
        if (!scope.exception() && appendSqliteArguments(self->module, scope, arguments, argc, argv)) [[likely]] {
            JSC::JSValue result = callSqliteCallback(self->module, self->callback, JSC::jsUndefined(), arguments);
            if (!scope.exception()) [[likely]]
                self->module.setResult(context, result);
        }
        if (scope.exception()) [[unlikely]]
            sqlite3_result_error(context, "", 0);
    }

    static void xDestroy(void* self) { delete static_cast<SqliteUserFunction*>(self); }
};

template<typename Module>
struct SqliteUserAggregate {
    WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(SqliteUserAggregate);

    Module module;
    // The first accumulator of a group. A function is called to make it.
    JSC::JSValue start;
    JSC::JSObject* step;
    // Null: not usable as a window function.
    JSC::JSObject* inverse;
    // Null: the accumulator is the result.
    JSC::JSObject* result;

    static int create(sqlite3* db, const char* name, int argumentCount, int flags, Module&& module, JSC::JSValue start, JSC::JSObject* step, JSC::JSObject* inverse, JSC::JSObject* result)
    {
        return sqlite3_create_window_function(db, name, argumentCount, flags, new SqliteUserAggregate { WTF::move(module), start, step, inverse, result },
            xStep, xFinal, inverse ? xValue : nullptr, inverse ? xInverse : nullptr, xDestroy);
    }

private:
    // Lives in sqlite3_aggregate_context(), which starts as zeroes, until xFinal.
    // A window function keeps it from one sqlite3_step() to the next, so it has to be a root.
    struct Accumulator {
        JSC::Strong<JSC::Unknown> value;
        bool initialized;
        bool isWindow;
    };

    // Null when there is none: out of memory, or `start` threw.
    Accumulator* accumulator(sqlite3_context* context, JSC::TopExceptionScope& scope)
    {
        auto* accumulator = static_cast<Accumulator*>(sqlite3_aggregate_context(context, sizeof(Accumulator)));
        if (!accumulator || accumulator->initialized)
            return accumulator;

        auto& vm = JSC::getVM(module.globalObject);
        new (accumulator) Accumulator();
        accumulator->initialized = true;
        // What xFinal finds if `start` throws.
        accumulator->value.set(vm, JSC::jsUndefined());

        JSC::JSValue first = start;
        if (first.isCallable()) {
            first = callSqliteCallback(module, first.getObject(), Module::thisOfStartAndResult(), JSC::ArgList());
            if (scope.exception()) [[unlikely]] {
                sqlite3_result_error(context, "", 0);
                return nullptr;
            }
        }
        accumulator->value.set(vm, first);
        return accumulator;
    }

    static void destroyAccumulator(sqlite3_context* context)
    {
        auto* accumulator = static_cast<Accumulator*>(sqlite3_aggregate_context(context, 0));
        if (accumulator && accumulator->initialized) {
            accumulator->~Accumulator();
            accumulator->initialized = false;
        }
    }

    void stepOrInverse(sqlite3_context* context, int argc, sqlite3_value** argv, JSC::JSObject* callback)
    {
        if (sqliteFailsIfScriptIsForbidden(context)) [[unlikely]]
            return;
        auto& vm = JSC::getVM(module.globalObject);
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        if (scope.exception()) [[unlikely]]
            return;
        auto* accumulator = this->accumulator(context, scope);
        if (!accumulator)
            return;

        JSC::MarkedArgumentBuffer arguments;
        arguments.ensureCapacity(argc + 1);
        arguments.append(accumulator->value.get());
        if (appendSqliteArguments(module, scope, arguments, argc, argv)) [[likely]] {
            JSC::JSValue next = callSqliteCallback(module, callback, JSC::jsUndefined(), arguments);
            if (!scope.exception() && !(Module::undefinedKeepsAccumulator && next.isUndefined())) [[likely]]
                accumulator->value.set(vm, next);
        }
        if (scope.exception()) [[unlikely]]
            sqlite3_result_error(context, "", 0);
    }

    void valueOrFinal(sqlite3_context* context, bool isFinal)
    {
        if (sqliteFailsIfScriptIsForbidden(context)) [[unlikely]] {
            if (isFinal)
                destroyAccumulator(context);
            return;
        }
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(JSC::getVM(module.globalObject));
        auto* accumulator = scope.exception() ? nullptr : this->accumulator(context, scope);

        // A window function gives its results through xValue. xFinal only ends it.
        if (accumulator && !(isFinal && accumulator->isWindow)) {
            accumulator->isWindow = !isFinal;

            JSC::JSValue value = accumulator->value.get();
            if (result) {
                JSC::MarkedArgumentBuffer arguments;
                arguments.append(value);
                value = callSqliteCallback(module, result, Module::thisOfStartAndResult(), arguments);
            }
            if (!scope.exception()) [[likely]]
                module.setResult(context, value);
            if (scope.exception()) [[unlikely]]
                sqlite3_result_error(context, "", 0);
        }

        if (isFinal)
            destroyAccumulator(context);
    }

    static SqliteUserAggregate* from(sqlite3_context* context) { return static_cast<SqliteUserAggregate*>(sqlite3_user_data(context)); }
    static void xStep(sqlite3_context* context, int argc, sqlite3_value** argv) { from(context)->stepOrInverse(context, argc, argv, from(context)->step); }
    static void xInverse(sqlite3_context* context, int argc, sqlite3_value** argv) { from(context)->stepOrInverse(context, argc, argv, from(context)->inverse); }
    static void xValue(sqlite3_context* context) { from(context)->valueOrFinal(context, false); }
    static void xFinal(sqlite3_context* context) { from(context)->valueOrFinal(context, true); }
    static void xDestroy(void* self) { delete static_cast<SqliteUserAggregate*>(self); }
};

} // namespace Bun
