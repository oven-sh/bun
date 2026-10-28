#include "root.h"

#include <JavaScriptCore/DeletePropertySlot.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/ErrorInstanceInlines.h>
#include <JavaScriptCore/JSCInlines.h>
#include "BunClientData.h"
#include "InternalModuleRegistry.h"
#include "ZigGlobalObject.h"
#include "helpers.h"

namespace Bun {

using namespace JSC;

// `SQLErrorClass` in src/sql_jsc/jsc.rs.
enum class SQLErrorClass : uint8_t {
    Postgres = 0,
    MySQL = 1,
};

// Not a LazyProperty: requireId() can throw, and the initializer of a LazyProperty cannot fail.
static Structure* sqlErrorStructure(VM& vm, Zig::GlobalObject* realm, SQLErrorClass errorClass)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    bool isMySQL = errorClass == SQLErrorClass::MySQL;
    auto& slot = isMySQL ? realm->m_mySQLErrorStructure : realm->m_postgresErrorStructure;
    if (auto* structure = slot.get())
        return structure;

    // The adapter that makes the error has loaded this module, so no JavaScript runs here.
    JSValue classes = BUN_REQUIRE_INTERNAL_MODULE(realm, InternalSqlErrors, "bun:sql", "MySQLError"_s, "PostgresError"_s);
    RETURN_IF_EXCEPTION(scope, nullptr);
    RELEASE_ASSERT(classes.isObject());
    JSValue constructor = classes.getObject()->getDirect(vm, Identifier::fromString(vm, isMySQL ? "MySQLError"_s : "PostgresError"_s));
    RELEASE_ASSERT(constructor && constructor.isObject());
    // `prototype` of a class is an own data property that user code cannot change. A compiled class makes it when it is first read.
    JSValue prototype = constructor.getObject()->get(realm, vm.propertyNames->prototype);
    RETURN_IF_EXCEPTION(scope, nullptr);
    RELEASE_ASSERT(prototype.isObject());

    auto* structure = ErrorInstance::createStructure(vm, realm, prototype);
    slot.set(vm, realm, structure);
    return structure;
}

extern "C" JSC::EncodedJSValue Bun__SQLError__create(JSC::JSGlobalObject* globalObject, SQLErrorClass errorClass, const unsigned char* messagePtr, size_t messageLength)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* realm = defaultGlobalObject(globalObject);
    auto* structure = sqlErrorStructure(vm, realm, errorClass);
    RETURN_IF_EXCEPTION(scope, {});

    String message = messageLength ? Zig::convertUTF8ToString(std::span { messagePtr, messageLength }) : emptyString();
    if (message.isNull()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    auto* error = ErrorInstance::create(vm, structure, message, JSValue());
    // Materialized now with no frames, so that nothing later writes a source position over the server's `line` and `column`.
    error->setErrorInfoForEmbedderError({}, {}, String(emptyString()));
    error->setStackPropertyProvidedByCapturedStackTrace();
    error->materializeErrorInfoIfNeeded(vm);
    DeletePropertySlot deleteSlot;
    JSObject::deleteProperty(error, globalObject, vm.propertyNames->line, deleteSlot);
    JSObject::deleteProperty(error, globalObject, vm.propertyNames->column, deleteSlot);
    // The first read makes `stack`, in the code of the reader and not in the client.
    error->putDirectCustomAccessor(vm, vm.propertyNames->stack, realm->m_lazyStackCustomGetterSetter.get(realm), PropertyAttribute::DontEnum | PropertyAttribute::CustomAccessor);
    // Own and enumerable, as `this.name = ...` in the constructor of the class makes it.
    auto& strings = commonStrings(vm);
    error->putDirect(vm, vm.propertyNames->name, errorClass == SQLErrorClass::MySQL ? strings.mySQLErrorString() : strings.postgresErrorString(), 0);
    return JSValue::encode(error);
}

}
