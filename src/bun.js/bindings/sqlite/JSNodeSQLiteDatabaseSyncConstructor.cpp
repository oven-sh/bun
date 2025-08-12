#include "root.h"

#include "JSNodeSQLiteDatabaseSyncConstructor.h"
#include "JSNodeSQLiteDatabaseSync.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/text/WTFString.h>

#include "sqlite3_local.h"

#if LAZY_LOAD_SQLITE
#include "lazy_sqlite3.h"
#else
static inline int lazyLoadSQLite()
{
    return 0;
}
#endif

namespace Bun {

using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(nodeSQLiteDatabaseSyncConstructorCall);
static JSC_DECLARE_HOST_FUNCTION(nodeSQLiteDatabaseSyncConstructorConstruct);

const ClassInfo JSNodeSQLiteDatabaseSyncConstructor::s_info = { "DatabaseSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteDatabaseSyncConstructor) };

JSNodeSQLiteDatabaseSyncConstructor::JSNodeSQLiteDatabaseSyncConstructor(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure, nodeSQLiteDatabaseSyncConstructorCall, nodeSQLiteDatabaseSyncConstructorConstruct)
{
}

JSNodeSQLiteDatabaseSyncConstructor* JSNodeSQLiteDatabaseSyncConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* prototype)
{
    JSNodeSQLiteDatabaseSyncConstructor* constructor = new (NotNull, allocateCell<JSNodeSQLiteDatabaseSyncConstructor>(vm)) JSNodeSQLiteDatabaseSyncConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

void JSNodeSQLiteDatabaseSyncConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
{
    Base::finishCreation(vm, 1, "DatabaseSync"_s, PropertyAdditionMode::WithStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
}

JSC_DEFINE_HOST_FUNCTION(nodeSQLiteDatabaseSyncConstructorCall, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // DatabaseSync() called as function is not allowed - need proper Node.js error
    return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_CONSTRUCT_CALL_REQUIRED, "Cannot call constructor without `new`"_s);
}

JSC_DEFINE_HOST_FUNCTION(nodeSQLiteDatabaseSyncConstructorConstruct, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (lazyLoadSQLite() != 0) {
        throwVMError(globalObject, scope, createError(globalObject, "Failed to load SQLite"_s));
        return {};
    }

    // Get the database path from the first argument
    JSValue pathValue = callFrame->argument(0);
    
    // Validate path argument type (must be string, Uint8Array, or URL)
    if (pathValue.isUndefined() || (!pathValue.isString() && !pathValue.isObject())) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"path\" argument must be a string, Uint8Array, or URL without null bytes."_s);
    }
    
    String databasePath;
    if (pathValue.isString()) {
        databasePath = pathValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        // Check for null bytes in string
        if (databasePath.contains('\0')) {
            return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"path\" argument must be a string, Uint8Array, or URL without null bytes."_s);
        }
    } else {
        // Handle Uint8Array/Buffer case
        databasePath = pathValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        // Check for null bytes in buffer/binary data
        if (databasePath.contains('\0')) {
            return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"path\" argument must be a string, Uint8Array, or URL without null bytes."_s);
        }
    }

    // Check for options parameter (second argument)
    JSValue optionsValue = callFrame->argument(1);
    bool shouldOpen = true; // Default: open the database
    bool readOnly = false; // Default: read-write mode
    int timeout = 5000; // Default timeout
    
    if (!optionsValue.isUndefined()) {
        if (!optionsValue.isObject()) {
            return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"options\" argument must be an object."_s);
        }
        
        JSObject* optionsObject = optionsValue.getObject();
        
        // Parse "open" option
        JSValue openValue = optionsObject->get(globalObject, Identifier::fromString(vm, "open"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!openValue.isUndefined()) {
            if (!openValue.isBoolean()) {
                return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"options.open\" argument must be a boolean."_s);
            }
            shouldOpen = openValue.asBoolean();
        }
        
        // Parse "readOnly" option
        JSValue readOnlyValue = optionsObject->get(globalObject, Identifier::fromString(vm, "readOnly"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!readOnlyValue.isUndefined()) {
            if (!readOnlyValue.isBoolean()) {
                return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"options.readOnly\" argument must be a boolean."_s);
            }
            readOnly = readOnlyValue.asBoolean();
        }
        
        // Parse "timeout" option
        JSValue timeoutValue = optionsObject->get(globalObject, Identifier::fromString(vm, "timeout"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!timeoutValue.isUndefined()) {
            if (!timeoutValue.isNumber()) {
                return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"options.timeout\" argument must be an integer."_s);
            }
            double timeoutDouble = timeoutValue.asNumber();
            if (std::isnan(timeoutDouble) || std::isinf(timeoutDouble) || timeoutDouble != std::trunc(timeoutDouble)) {
                return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"options.timeout\" argument must be an integer."_s);
            }
            timeout = static_cast<int>(timeoutDouble);
        }
    }
    
    // TODO: Use timeout for busy timeout on database connection
    (void)timeout;

    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto* structure = zigGlobalObject->m_JSNodeSQLiteDatabaseSyncClassStructure.get(zigGlobalObject);
    
    JSNodeSQLiteDatabaseSync* thisObject = JSNodeSQLiteDatabaseSync::create(vm, structure);
    RETURN_IF_EXCEPTION(scope, {});

    // Store the path in the object
    thisObject->setPath(databasePath);

    // Only open the database if shouldOpen is true
    if (shouldOpen) {
        sqlite3* db = nullptr;
        CString pathUTF8 = databasePath.utf8();
        
        // Determine flags based on readOnly option
        int flags = readOnly ? SQLITE_OPEN_READONLY : (SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE);
        int result = sqlite3_open_v2(pathUTF8.data(), &db, flags, nullptr);
        
        if (result != SQLITE_OK) {
            const char* errorMsg = sqlite3_errmsg(db);
            if (db) {
                sqlite3_close(db);
            }
            throwVMError(globalObject, scope, createError(globalObject, String::fromUTF8(errorMsg)));
            return {};
        }

        thisObject->setDatabase(db);
    }

    return JSValue::encode(thisObject);
}

} // namespace Bun