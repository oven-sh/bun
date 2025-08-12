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
    } else if (pathValue.isObject()) {
        // Check if it's a URL object
        JSObject* pathObject = pathValue.getObject();
        JSValue hrefValue = pathObject->get(globalObject, Identifier::fromString(vm, "href"_s));
        RETURN_IF_EXCEPTION(scope, {});
        
        if (!hrefValue.isUndefined()) {
            // It's a URL object - check for file: scheme
            String href = hrefValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            
            if (!href.startsWith("file:"_s)) {
                return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_URL_SCHEME, "The URL must be of scheme file:"_s);
            }
            
            // Extract path from file:// URL
            if (href.startsWith("file:///"_s)) {
                databasePath = href.substring(7); // Remove "file://"
            } else if (href.startsWith("file:/"_s)) {
                databasePath = href.substring(5); // Remove "file:"
            } else {
                databasePath = href.substring(5); // Remove "file:"
            }
        } else {
            // Handle Uint8Array/Buffer case
            databasePath = pathValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
        
        // Check for null bytes in buffer/binary data
        if (databasePath.contains('\0')) {
            return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"path\" argument must be a string, Uint8Array, or URL without null bytes."_s);
        }
    } else {
        databasePath = pathValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        // Check for null bytes
        if (databasePath.contains('\0')) {
            return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"path\" argument must be a string, Uint8Array, or URL without null bytes."_s);
        }
    }

    // Check for options parameter (second argument)
    JSValue optionsValue = callFrame->argument(1);
    bool shouldOpen = true; // Default: open the database
    bool readOnly = false; // Default: read-write mode
    int timeout = 5000; // Default timeout
    bool enableForeignKeyConstraints = true; // Default: enabled
    bool enableDoubleQuotedStringLiterals = false; // Default: disabled
    bool readBigInts = false; // Default: disabled
    bool returnArrays = false; // Default: disabled  
    bool allowBareNamedParameters = true; // Default: enabled
    bool allowUnknownNamedParameters = false; // Default: disabled
    
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
        
        // Parse "enableForeignKeyConstraints" option
        JSValue enableForeignKeyConstraintsValue = optionsObject->get(globalObject, Identifier::fromString(vm, "enableForeignKeyConstraints"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!enableForeignKeyConstraintsValue.isUndefined()) {
            if (!enableForeignKeyConstraintsValue.isBoolean()) {
                return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"options.enableForeignKeyConstraints\" argument must be a boolean."_s);
            }
            enableForeignKeyConstraints = enableForeignKeyConstraintsValue.asBoolean();
        }
        
        // Parse "enableDoubleQuotedStringLiterals" option  
        JSValue enableDoubleQuotedStringLiteralsValue = optionsObject->get(globalObject, Identifier::fromString(vm, "enableDoubleQuotedStringLiterals"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!enableDoubleQuotedStringLiteralsValue.isUndefined()) {
            if (!enableDoubleQuotedStringLiteralsValue.isBoolean()) {
                return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"options.enableDoubleQuotedStringLiterals\" argument must be a boolean."_s);
            }
            enableDoubleQuotedStringLiterals = enableDoubleQuotedStringLiteralsValue.asBoolean();
        }
        
        // Parse "readBigInts" option
        JSValue readBigIntsValue = optionsObject->get(globalObject, Identifier::fromString(vm, "readBigInts"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!readBigIntsValue.isUndefined()) {
            if (!readBigIntsValue.isBoolean()) {
                return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"options.readBigInts\" argument must be a boolean."_s);
            }
            readBigInts = readBigIntsValue.asBoolean();
        }
        
        // Parse "returnArrays" option
        JSValue returnArraysValue = optionsObject->get(globalObject, Identifier::fromString(vm, "returnArrays"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!returnArraysValue.isUndefined()) {
            if (!returnArraysValue.isBoolean()) {
                return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"options.returnArrays\" argument must be a boolean."_s);
            }
            returnArrays = returnArraysValue.asBoolean();
        }
        
        // Parse "allowBareNamedParameters" option
        JSValue allowBareNamedParametersValue = optionsObject->get(globalObject, Identifier::fromString(vm, "allowBareNamedParameters"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!allowBareNamedParametersValue.isUndefined()) {
            if (!allowBareNamedParametersValue.isBoolean()) {
                return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"options.allowBareNamedParameters\" argument must be a boolean."_s);
            }
            allowBareNamedParameters = allowBareNamedParametersValue.asBoolean();
        }
        
        // Parse "allowUnknownNamedParameters" option
        JSValue allowUnknownNamedParametersValue = optionsObject->get(globalObject, Identifier::fromString(vm, "allowUnknownNamedParameters"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!allowUnknownNamedParametersValue.isUndefined()) {
            if (!allowUnknownNamedParametersValue.isBoolean()) {
                return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"options.allowUnknownNamedParameters\" argument must be a boolean."_s);
            }
            allowUnknownNamedParameters = allowUnknownNamedParametersValue.asBoolean();
        }
    }
    
    // TODO: Use timeout for busy timeout on database connection
    (void)timeout;

    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto* structure = zigGlobalObject->m_JSNodeSQLiteDatabaseSyncClassStructure.get(zigGlobalObject);
    
    JSNodeSQLiteDatabaseSync* thisObject = JSNodeSQLiteDatabaseSync::create(vm, structure);
    RETURN_IF_EXCEPTION(scope, {});

    // Store the path and options in the object
    thisObject->setPath(databasePath);
    thisObject->setOptions(readBigInts, returnArrays, allowBareNamedParameters, allowUnknownNamedParameters);

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

        // Apply SQLite settings based on options
        if (enableForeignKeyConstraints) {
            sqlite3_exec(db, "PRAGMA foreign_keys = ON", nullptr, nullptr, nullptr);
        } else {
            sqlite3_exec(db, "PRAGMA foreign_keys = OFF", nullptr, nullptr, nullptr);
        }
        
        // Note: SQLite doesn't have a direct way to control double-quoted string literals
        // This behavior is handled at compile time, not runtime
        // For now, we store the option but don't apply any PRAGMA
        (void)enableDoubleQuotedStringLiterals;

        thisObject->setDatabase(db);
    }

    return JSValue::encode(thisObject);
}

} // namespace Bun