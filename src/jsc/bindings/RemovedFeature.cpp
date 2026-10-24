#include "root.h"
#include "RemovableFeatures.h"
#include "ErrorCode.h"
#include "BunCompiledModules.h"
#include <JavaScriptCore/AOTBuiltinTable.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ProxyObject.h>
#include <algorithm>
#include <cstdlib>
#include <iterator>
#include <span>

#if OS(WINDOWS)
#include <corecrt_io.h>
#else
#include <poll.h>
#include <unistd.h>
#endif

#if OS(DARWIN)
#include <mach-o/loader.h>
#include <sys/mman.h>
#endif

namespace Bun {

static const RemovableFeatureText* findText(uint16_t index)
{
    const auto* end = std::end(removableFeatureTexts);
    const auto* text = std::lower_bound(std::begin(removableFeatureTexts), end, index, [](const RemovableFeatureText& entry, uint16_t value) {
        return entry.index < value;
    });
    return text != end && text->index == index ? text : nullptr;
}

ASCIILiteral textOfRemovableFeature(JSC::RemovableFeature feature)
{
    const auto* text = findText(static_cast<uint16_t>(feature));
    return text ? text->text : "a part of Bun"_s;
}

ASCIILiteral trimFeatureNameOf(JSC::RemovableFeature feature)
{
    const auto* text = findText(static_cast<uint16_t>(feature));
    return text ? text->trimFeatureName : ""_s;
}

static bool isRemoved(uint16_t feature)
{
    return feature >= JSC::removableFeatureIndexLimit || JSC::isFeatureRemoved(static_cast<JSC::RemovableFeature>(feature));
}

static bool isRemovedByRequest(uint16_t feature)
{
    return feature < JSC::removableFeatureIndexLimit && JSC::removalOf(static_cast<JSC::RemovableFeature>(feature)) == JSC::FeatureRemoval::Requested;
}

static WTF::String messageOfRemovedFeature(const WTF::String& api, uint16_t feature)
{
    WTF::String removed = api.isEmpty() ? WTF::String(textOfRemovableFeature(static_cast<JSC::RemovableFeature>(feature))) : api;
    auto name = trimFeatureNameOf(static_cast<JSC::RemovableFeature>(feature));
    if (isRemovedByRequest(feature))
        return WTF::makeString(removed, " isn't in this executable: it was built with compile.trim.remove in Bun.build()."_s);
    if (name.isEmpty())
        return WTF::makeString(removed, " was removed by --trim because your code never uses it. To keep it, use it somewhere in your code."_s);
    return WTF::makeString(removed, " was removed by --trim because your code never uses it. To keep it, add \""_s, name, "\" to compile.trim.allow in Bun.build()."_s);
}

#if ENABLE(AOT)
static bool hasPublicPath(const JSC::AOT::BuiltinTable& table, JSC::AOT::BuiltinID builtin)
{
    return table.contains(builtin) && table.at(builtin).kind != JSC::AOT::BuiltinKind::NativeBinding;
}
#endif

static JSC::EncodedJSValue throwFeatureRemovedError(JSC::JSGlobalObject* globalObject, const WTF::String& message)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* error = JSC::createError(globalObject, message);
    error->putDirect(vm, JSC::Identifier::fromString(vm, "code"_s), JSC::jsString(vm, WTF::String("ERR_FEATURE_REMOVED"_s)));
    JSC::throwException(globalObject, scope, error);
    return {};
}

static WTF::String moduleNotCompiledInMessage(const WTF::String& specifier)
{
    return WTF::makeString("Cannot load '"_s, specifier, "': it isn't in this executable. Import it by name somewhere in your program to keep it."_s);
}

static void writeToStandardError(std::span<const char> text)
{
#if OS(WINDOWS)
    (void)_write(2, text.data(), static_cast<unsigned>(text.size()));
#else
    struct pollfd standardError = { STDERR_FILENO, POLLOUT, 0 };
    if (poll(&standardError, 1, 0) > 0)
        (void)!write(STDERR_FILENO, text.data(), text.size());
#endif
}

static void writeFeatureNumber(uint16_t feature)
{
    char digits[6];
    size_t last = sizeof(digits) - 1;
    size_t first = last;
    digits[first] = 0;
    for (uint32_t number = feature; number || !digits[first]; number /= 10)
        digits[--first] = static_cast<char>('0' + number % 10);
    writeToStandardError(std::span<const char> { digits }.subspan(first, last - first));
}

}

extern "C" JSC::EncodedJSValue Bun__throwForRemovedFeature(JSC::JSGlobalObject* globalObject, uint16_t feature)
{
    return Bun::throwFeatureRemovedError(globalObject, Bun::messageOfRemovedFeature(WTF::String(), feature));
}

extern "C" JSC::EncodedJSValue Bun__throwForRemovedFunction(JSC::JSGlobalObject* globalObject, uint16_t feature, WTF::StringImpl* name)
{
    return Bun::throwFeatureRemovedError(globalObject, Bun::messageOfRemovedFeature(WTF::String(name), feature));
}

extern "C" JSC::EncodedJSValue Bun__throwForRemovedBuiltin(JSC::JSGlobalObject* globalObject, uint16_t feature, uint32_t builtin)
{
#if ENABLE(AOT)
    const auto& table = JSC::AOT::BuiltinTable::singleton();
    JSC::AOT::BuiltinID id { builtin };
    if (!Bun::hasPublicPath(table, id))
        return Bun__throwForRemovedFeature(globalObject, feature);
    return Bun::throwFeatureRemovedError(globalObject, Bun::messageOfRemovedFeature(table.textOf(id), feature));
#else
    UNUSED_PARAM(builtin);
    return Bun__throwForRemovedFeature(globalObject, feature);
#endif
}

extern "C" [[noreturn]] void Bun__abortForRemovedFeature(uint16_t feature)
{
    auto text = Bun::textOfRemovableFeature(static_cast<JSC::RemovableFeature>(feature)).span();
    const char* beBun = getenv("BUN_BE_BUN");
    bool actsAsBun = beBun && *beBun;
    Bun::writeToStandardError(actsAsBun ? "error: BUN_BE_BUN is set, but this executable doesn't include "_span : "error: --trim removed "_span);
    Bun::writeToStandardError(text);
    if (actsAsBun) {
        Bun::writeToStandardError(". Run bun instead.\n"_span);
        _exit(70);
    }
    Bun::writeToStandardError(" from this executable, but the program needs it."_span);
    if (Bun::isRemovedByRequest(feature)) {
        Bun::writeToStandardError(" It is listed in compile.trim.remove.\n"_span);
        _exit(70);
    }
    Bun::writeToStandardError(getenv("BUN_OPTIONS") ? " An option in BUN_OPTIONS may be the cause. If not, this is a bug in Bun."_span : " This is a bug in Bun."_span);
    Bun::writeToStandardError(" Please report it with this number: "_span);
    Bun::writeFeatureNumber(feature);
    Bun::writeToStandardError("\n"_span);
    _exit(70);
}

extern "C" [[noreturn]] void Bun__abortForRemovedLocaleData()
{
    Bun::writeToStandardError("error: the locale data this program needs was removed by --trim. Add the locale to compile.trim.locales to keep it.\n"_span);
    _exit(70);
}

extern "C" bool Bun__throwIfModuleIsRemoved(JSC::JSGlobalObject* globalObject, uint16_t feature, const char* specifier, size_t length, Bun::ErrorCode code)
{
    if (!Bun::isRemoved(feature))
        return false;
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto message = Bun::moduleNotCompiledInMessage(WTF::String::fromUTF8(std::span { specifier, length }));
    JSC::throwException(globalObject, scope, Bun::createError(globalObject, code, message));
    return true;
}

extern "C" JSC::EncodedJSValue Bun__createStandInForRemovedInstance(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedConstructor)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue prototype = JSC::JSValue::decode(encodedConstructor).get(globalObject, vm.propertyNames->prototype);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::constructEmptyObject(globalObject, JSC::asObject(prototype)));
}

namespace Bun {

JSC_DEFINE_HOST_FUNCTION(constructRemovedBinding, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return uncheckedDowncast<JSC::JSNativeStdFunction>(callFrame->jsCallee())->function()(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(getMemberOfRemovedBinding, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto name = callFrame->argument(1).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto* handler = JSC::asObject(callFrame->thisValue());
    if (name == vm.propertyNames->toPrimitiveSymbol || name == vm.propertyNames->iteratorSymbol)
        return JSC::JSValue::encode(handler->getDirect(vm, name));
    if (name.isSymbol() || name == vm.propertyNames->then)
        return JSC::JSValue::encode(JSC::jsUndefined());
    return JSC::JSValue::encode(handler->getDirect(vm, vm.propertyNames->value));
}

JSC_DEFINE_HOST_FUNCTION(convertRemovedBindingToPrimitive, (JSC::JSGlobalObject*, JSC::CallFrame*))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(getNextElementOfRemovedBinding, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSValue standIn = JSC::asObject(callFrame->thisValue())->getDirect(vm, vm.propertyNames->value);
    return JSC::JSValue::encode(JSC::createIteratorResultObject(globalObject, standIn, false));
}

JSC_DEFINE_HOST_FUNCTION(iterateRemovedBinding, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto* iterator = JSC::constructEmptyObject(globalObject);
    iterator->putDirect(vm, vm.propertyNames->value, callFrame->thisValue());
    iterator->putDirectNativeFunction(vm, globalObject, vm.propertyNames->next, 0, getNextElementOfRemovedBinding, JSC::ImplementationVisibility::Private, JSC::NoIntrinsic, 0);
    return JSC::JSValue::encode(iterator);
}

}

// A module reads the members of its native bindings while it is imported, and an import doesn't throw. Every member is the stand-in itself.
// A module may also use a member as a number or a property key, or destructure the binding as an array.
extern "C" JSC::EncodedJSValue Bun__createStandInForRemovedBinding(JSC::JSGlobalObject* globalObject, uint16_t feature)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto throwForFeature = [feature](JSC::JSGlobalObject* realm, JSC::CallFrame*) {
        return Bun__throwForRemovedFeature(realm, feature);
    };
    auto* target = JSC::JSNativeStdFunction::create(vm, globalObject, 0, WTF::String(), WTF::move(throwForFeature), JSC::NoIntrinsic, JSC::NativeFunction(Bun::constructRemovedBinding));
    auto* handler = JSC::constructEmptyObject(globalObject);
    handler->putDirectNativeFunction(vm, globalObject, vm.propertyNames->get, 3, Bun::getMemberOfRemovedBinding, JSC::ImplementationVisibility::Private, JSC::NoIntrinsic, 0);
    handler->putDirectNativeFunction(vm, globalObject, vm.propertyNames->toPrimitiveSymbol, 1, Bun::convertRemovedBindingToPrimitive, JSC::ImplementationVisibility::Private, JSC::NoIntrinsic, 0);
    handler->putDirectNativeFunction(vm, globalObject, vm.propertyNames->iteratorSymbol, 0, Bun::iterateRemovedBinding, JSC::ImplementationVisibility::Private, JSC::NoIntrinsic, 0);
    auto* standIn = JSC::ProxyObject::create(globalObject, target, handler);
    RETURN_IF_EXCEPTION(scope, {});
    handler->putDirect(vm, vm.propertyNames->value, standIn);
    return JSC::JSValue::encode(standIn);
}

extern "C" JSC::EncodedJSValue Bun__createModuleNotCompiledInError(JSC::JSGlobalObject* globalObject, Bun::ErrorCode code, const BunString* specifier)
{
    WTF::String name = specifier->toWTFString(BunString::ZeroCopy);
    bool isPath = name.startsWith('/') || (name.length() > 2 && name[1] == ':' && (name[2] == '/' || name[2] == '\\'));
    if (isPath)
        return JSC::JSValue::encode(Bun::createNotInExecutableError(globalObject, code, name));
    return JSC::JSValue::encode(Bun::createError(globalObject, code, Bun::moduleNotCompiledInMessage(name)));
}

#if OS(DARWIN)
extern "C" struct mach_header __dso_handle;
#endif

extern "C" void Bun__prepareTrimmedExecutable()
{
#if OS(DARWIN)
    const auto* header = reinterpret_cast<const mach_header_64*>(&__dso_handle);
    const auto* command = reinterpret_cast<const load_command*>(header + 1);
    uintptr_t slide = 0;
    for (uint32_t index = 0; index < header->ncmds; index++) {
        if (command->cmd == LC_SEGMENT_64) {
            const auto* segment = reinterpret_cast<const segment_command_64*>(command);
            if (!segment->fileoff && segment->filesize)
                slide = reinterpret_cast<uintptr_t>(header) - segment->vmaddr;
            else if (segment->flags & SG_READ_ONLY)
                mprotect(reinterpret_cast<void*>(segment->vmaddr + slide), segment->vmsize, PROT_READ);
        }
        command = reinterpret_cast<const load_command*>(reinterpret_cast<const char*>(command) + command->cmdsize);
    }
#endif
}
