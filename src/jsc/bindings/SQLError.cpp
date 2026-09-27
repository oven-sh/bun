#include "root.h"

#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/ErrorInstanceInlines.h>
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/text/MakeString.h>
#include "BunClientData.h"
#include "InternalModuleRegistry.h"
#include "SQLError.h"
#include "ZigGlobalObject.h"
#include "helpers.h"

namespace Bun {

using namespace JSC;

Structure* createSQLErrorStructure(VM& vm, JSGlobalObject* globalObject, ASCIILiteral className)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    // The adapter that makes the error has loaded this module, so no JavaScript runs here.
    JSValue classes = defaultGlobalObject(globalObject)->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::Field::InternalSqlErrors);
    RETURN_IF_EXCEPTION(scope, nullptr);
    RELEASE_ASSERT(classes.isObject());
    JSValue constructor = classes.getObject()->getDirect(vm, Identifier::fromString(vm, className));
    RELEASE_ASSERT(constructor && constructor.isObject());
    // `prototype` of a class is an own data property that user code cannot change.
    JSValue prototype = constructor.getObject()->getDirect(vm, vm.propertyNames->prototype);
    RELEASE_ASSERT(prototype && prototype.isObject());
    return ErrorInstance::createStructure(vm, globalObject, prototype);
}

// An instance of `MySQLError` or `PostgresError` of the realm of `globalObject`, made with no call
// into JavaScript.
//
// The client makes an error while no JavaScript runs, or below frames of Bun's own modules, so the
// error keeps no stack frames and `stack` is "<name>: <message>". The error info is materialized
// here: JSC writes `stack`, `line` and `column` of an error once, on the first read of one of them,
// and PostgreSQL has fields named `line` and `column`. After this call nothing writes them again.
// Frames for `stack` have to be collected before the error info is materialized.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue Bun__SQLError__create(JSC::JSGlobalObject* globalObject, bool isMySQL, const char* messagePtr, size_t messageLength)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* realm = defaultGlobalObject(globalObject);

    auto* structure = (isMySQL ? realm->m_mySQLErrorStructure : realm->m_postgresErrorStructure).getInitializedOnMainThread(realm);
    RETURN_IF_EXCEPTION(scope, {});

    ASCIILiteral name = isMySQL ? "MySQLError"_s : "PostgresError"_s;
    String message = messageLength
        ? Zig::convertUTF8ToString(std::span { reinterpret_cast<const unsigned char*>(messagePtr), messageLength })
        : emptyString();
    String stack = message.isEmpty() ? String(name) : tryMakeString(name, ": "_s, message);
    if (message.isNull() || stack.isNull()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    auto* error = ErrorInstance::create(vm, structure, message, JSValue());
    error->setErrorInfoForEmbedderError({}, {}, WTF::move(stack));
    error->materializeErrorInfoIfNeeded(vm);
    // The position of no source. The caller writes the server's `line` and `column`, if any.
    error->putDirect(vm, vm.propertyNames->line, jsUndefined(), static_cast<unsigned>(PropertyAttribute::DontEnum));
    error->putDirect(vm, vm.propertyNames->column, jsUndefined(), static_cast<unsigned>(PropertyAttribute::DontEnum));
    // Own and enumerable, as `this.name = ...` in the constructor of the class makes it.
    auto& strings = commonStrings(vm);
    error->putDirect(vm, vm.propertyNames->name, isMySQL ? strings.mySQLErrorString() : strings.postgresErrorString(), 0);
    return JSValue::encode(error);
}

}
