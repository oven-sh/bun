#include "root.h"

#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/ErrorInstanceInlines.h>
#include <JavaScriptCore/JSCInlines.h>
#include "BunClientData.h"
#include "InternalModuleRegistry.h"
#include "ZigGlobalObject.h"
#include "helpers.h"

namespace Bun {

using namespace JSC;

// Not a LazyProperty: requireId() can throw, and the initializer of a LazyProperty cannot fail.
static Structure* sqlErrorStructure(VM& vm, Zig::GlobalObject* realm, bool isMySQL)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto& slot = isMySQL ? realm->m_mySQLErrorStructure : realm->m_postgresErrorStructure;
    if (auto* structure = slot.get())
        return structure;

    // The adapter that makes the error has loaded this module, so no JavaScript runs here.
    JSValue classes = realm->internalModuleRegistry()->requireId(realm, vm, InternalModuleRegistry::Field::InternalSqlErrors);
    RETURN_IF_EXCEPTION(scope, nullptr);
    RELEASE_ASSERT(classes.isObject());
    JSValue constructor = classes.getObject()->getDirect(vm, Identifier::fromString(vm, isMySQL ? "MySQLError"_s : "PostgresError"_s));
    RELEASE_ASSERT(constructor && constructor.isObject());
    // `prototype` of a class is an own data property that user code cannot change.
    JSValue prototype = constructor.getObject()->getDirect(vm, vm.propertyNames->prototype);
    RELEASE_ASSERT(prototype && prototype.isObject());

    auto* structure = ErrorInstance::createStructure(vm, realm, prototype);
    slot.set(vm, realm, structure);
    return structure;
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue Bun__SQLError__create(JSC::JSGlobalObject* globalObject, bool isMySQL, const char* messagePtr, size_t messageLength)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* realm = defaultGlobalObject(globalObject);
    auto* structure = sqlErrorStructure(vm, realm, isMySQL);
    RETURN_IF_EXCEPTION(scope, {});

    String message = messageLength
        ? Zig::convertUTF8ToString(std::span { reinterpret_cast<const unsigned char*>(messagePtr), messageLength })
        : emptyString();
    if (message.isNull()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    auto* error = ErrorInstance::create(vm, structure, message, JSValue());
    // Filled now, so that a later fill cannot overwrite the server's `line` and `column`.
    error->setErrorInfoForEmbedderError({}, {}, String(emptyString()));
    error->setStackPropertyAlreadyMaterialized();
    error->materializeErrorInfoIfNeeded(vm);
    // The position of no source. The caller writes the server's `line` and `column`, if any.
    error->putDirect(vm, vm.propertyNames->line, jsUndefined(), static_cast<unsigned>(PropertyAttribute::DontEnum));
    error->putDirect(vm, vm.propertyNames->column, jsUndefined(), static_cast<unsigned>(PropertyAttribute::DontEnum));
    // The first read makes `stack`, in the code of the reader and not in the client.
    error->putDirectCustomAccessor(vm, vm.propertyNames->stack, realm->m_lazyStackCustomGetterSetter.get(realm), PropertyAttribute::DontEnum | PropertyAttribute::CustomAccessor);
    // Own and enumerable, as `this.name = ...` in the constructor of the class makes it.
    auto& strings = commonStrings(vm);
    error->putDirect(vm, vm.propertyNames->name, isMySQL ? strings.mySQLErrorString() : strings.postgresErrorString(), 0);
    return JSValue::encode(error);
}

}
