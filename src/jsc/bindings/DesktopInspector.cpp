// What src/desktop/devtools finds out about values. None of it runs a script, unless it says so.
#include "root.h"
#include "DesktopRealm.h"
#include "ErrorStackTrace.h"
#include "ZigGlobalObject.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/BigIntObject.h>
#include <JavaScriptCore/BooleanObject.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/DateConversion.h>
#include <JavaScriptCore/DateInstance.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayIterator.h>
#include <JavaScriptCore/JSAsyncGenerator.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSCustomGetterFunction.h>
#include <JavaScriptCore/JSDataView.h>
#include <JavaScriptCore/JSGenerator.h>
#include <JavaScriptCore/JSGlobalLexicalEnvironment.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSMapIterator.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSSetInlines.h>
#include <JavaScriptCore/JSSetIterator.h>
#include <JavaScriptCore/JSStringIterator.h>
#include <JavaScriptCore/JSWeakMapInlines.h>
#include <JavaScriptCore/JSWeakObjectRef.h>
#include <JavaScriptCore/JSWeakSet.h>
#include <JavaScriptCore/JSWithScope.h>
#include <JavaScriptCore/NumberObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ParserError.h>
#include <JavaScriptCore/ProxyObject.h>
#include <JavaScriptCore/RegExpObject.h>
#include <JavaScriptCore/RegularExpression.h>
#include <JavaScriptCore/StringObject.h>
#include <JavaScriptCore/SymbolObject.h>

namespace Bun {
using namespace JSC;

static EncodedJSValue listOf(JSGlobalObject* realm, MarkedArgumentBuffer& all)
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    if (all.hasOverflowed()) {
        throwOutOfMemoryError(realm, scope);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(realm, static_cast<ArrayAllocationProfile*>(nullptr), all)));
}

static bool isNative(JSValue value)
{
    auto* function = dynamicDowncast<JSFunction>(value);
    return function && function->isHostOrBuiltinFunction() && !function->inherits<JSBoundFunction>() && !function->inherits<JSNativeStdFunction>();
}

static JSObject* prototypeOf(JSGlobalObject* realm, JSObject* object)
{
    if (object->type() == ProxyObjectType)
        return nullptr;
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(realm->vm());
    JSValue prototype = object->getPrototype(realm);
    if (scope.exception()) {
        (void)scope.clearExceptionExceptTermination();
        return nullptr;
    }
    return prototype.getObject();
}

// Empty if it is written in JavaScript, changes something, or throws.
static JSValue callNativeGetter(JSGlobalObject* realm, JSValue getter, JSValue receiver)
{
    VM& vm = realm->vm();
    if (!isNative(getter))
        return {};
    auto* function = uncheckedDowncast<JSFunction>(getter);
    String name = function->isHostFunction() ? function->name(vm) : function->jsExecutable()->ecmaName().string();
    if (function->inherits<JSCustomGetterFunction>())
        name = makeString("get "_s, name);
    // A script can make any function a getter. `flags` reads properties.
    if (!name.startsWith("get "_s) || name == "get __proto__"_s || name == "get flags"_s)
        return {};
    if (name == "get body"_s && receiver.isObject()) {
        String className = JSObject::calculatedClassName(asObject(receiver));
        if (className == "Request"_s || className == "Response"_s)
            return {};
    }
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue value = call(realm, getter, getCallData(getter), receiver, ArgList());
    if (scope.exception()) {
        (void)scope.clearExceptionExceptTermination();
        return {};
    }
    if (auto* promise = dynamicDowncast<JSPromise>(value); promise && promise->status() == JSPromise::Status::Rejected)
        promise->markAsHandled();
    return value;
}

// By `Error.prepareStackTrace`, as soon as somebody asks for the stack.
static bool isYetToBeFormatted(VM& vm, JSObject* object)
{
    auto* error = dynamicDowncast<ErrorInstance>(object);
    if (!error)
        return false;
    // `Error.captureStackTrace()` leaves a getter.
    unsigned attributes = 0;
    error->structure()->get(vm, vm.propertyNames->stack, attributes);
    if (error->hasMaterializedErrorInfo() && !(attributes & PropertyAttribute::CustomAccessorOrValue))
        return false;
    auto* home = dynamicDowncast<Zig::GlobalObject>(error->realmMayBeNull());
    return !home || home->m_errorConstructorPrepareStackTraceValue.get();
}

static bool isUninitialized(VM& vm, JSObject* object, const Identifier& name)
{
    auto* scope = dynamicDowncast<JSGlobalLexicalEnvironment>(object);
    if (!scope)
        return false;
    PropertySlot slot(scope, PropertySlot::InternalMethodType::VMInquiry, &vm);
    return JSGlobalLexicalEnvironment::getOwnPropertySlot(scope, scope->realm(), name, slot) && !slot.getValue(scope->realm(), name);
}

// `base[name]`. Empty if that takes a script.
static JSValue peek(JSGlobalObject* realm, JSValue base, const Identifier& name, bool& isFound)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(realm->vm());
    isFound = true;
    JSObject* object = base.isUndefinedOrNull() ? nullptr : base.toObject(realm);
    for (; object && !scope.exception(); object = prototypeOf(realm, object)) {
        auto& names = *realm->vm().propertyNames;
        bool isOfStack = name == names.stack || name == names.line || name == names.column || name == names.sourceURL;
        if (object->type() == ProxyObjectType || isUninitialized(realm->vm(), object, name) || (isOfStack && isYetToBeFormatted(realm->vm(), object)))
            return {};
        PropertyDescriptor descriptor;
        bool exists = object->getOwnPropertyDescriptor(realm, name, descriptor);
        if (scope.exception())
            break;
        if (!exists)
            continue;
        if (descriptor.isDataDescriptor())
            return descriptor.value();
        return descriptor.getterPresent() && descriptor.getter().isObject() ? callNativeGetter(realm, descriptor.getter(), base) : jsUndefined();
    }
    if (scope.exception() || base.isUndefinedOrNull()) {
        (void)scope.clearExceptionExceptTermination();
        return {};
    }
    isFound = false;
    return jsUndefined();
}

static String peekAtText(JSGlobalObject* realm, JSObject* object, const Identifier& name)
{
    bool isFound;
    JSValue value = peek(realm, object, name, isFound);
    return value && value.isString() ? asString(value)->tryGetValue() : String();
}

// Without `base` it is what the scripts have declared. Empty if that takes a script, or if it `mustExist` and does not.
extern "C" EncodedJSValue Bun__Inspector__peek(JSGlobalObject* realm, EncodedJSValue base, const BunString* key, bool mustExist)
{
    bool isFound;
    JSValue holder = JSValue::decode(base) ? JSValue::decode(base) : realm->globalLexicalEnvironment();
    JSValue value = peek(realm, holder, Identifier::fromString(realm->vm(), key->toWTFString()), isFound);
    return JSValue::encode(isFound || !mustExist ? value : JSValue());
}

extern "C" bool Bun__Inspector__matches(const BunString* pattern, const BunString* text, bool isExact)
{
    if (isFeatureRemoved(RemovableFeature::RegExp))
        return false;
    Yarr::RegularExpression expression(pattern->toWTFString(), isExact ? OptionSet<Yarr::Flags>() : OptionSet { Yarr::Flags::IgnoreCase });
    return expression.isValid() && expression.match(text->toWTFString()) >= 0;
}

extern "C" bool Bun__Inspector__isNative(EncodedJSValue value, const BunString* name)
{
    if (!isNative(JSValue::decode(value)))
        return false;
    auto* function = uncheckedDowncast<JSFunction>(JSValue::decode(value));
    return function->name(function->vm()) == name->toWTFString();
}

static String describeError(JSGlobalObject* realm, JSObject* error, const String& className)
{
    auto& names = *realm->vm().propertyNames;
    String stack = peekAtText(realm, error, names.stack);
    String name = peekAtText(realm, error, names.name);
    String message = peekAtText(realm, error, names.message);
    if (name.isEmpty() || (name == "Error"_s && className.endsWith("Error"_s)))
        name = className;
    StringBuilder description;
    description.append(name, message.isEmpty() ? ""_s : ": "_s, message);
    for (auto line : StringView(stack).split('\n')) {
        if (line.startsWith("    at unknown:"_s))
            description.append("\n    at <anonymous>"_s, line.substring(14));
        else if (line.startsWith("    at "_s) && line != "    at unknown"_s && !line.endsWith("(unknown)"_s))
            description.append('\n', line);
    }
    return description.toString();
}

static std::pair<ASCIILiteral, String> subtypeAndDescription(JSGlobalObject* realm, JSObject* object, const String& className)
{
    VM& vm = realm->vm();
    auto sized = [&](size_t size) { return makeString(className, '(', size, ')'); };
    auto withLength = [&] {
        bool isFound;
        JSValue length = peek(realm, object, vm.propertyNames->length, isFound);
        return length && length.isNumber() ? sized(clampTo<size_t>(length.asNumber())) : className;
    };
    if (auto* proxy = dynamicDowncast<ProxyObject>(object))
        return { "proxy"_s, makeString("Proxy("_s, proxy->isRevoked() ? "Object"_s : JSObject::calculatedClassName(proxy->target()), ')') };
    if (auto* function = dynamicDowncast<JSFunction>(object)) {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        JSString* source = function->toString(realm);
        (void)scope.clearExceptionExceptTermination();
        return { {}, source ? source->tryGetValue() : className };
    }
    if (object->isCallable())
        return { {}, makeString("function "_s, peekAtText(realm, object, vm.propertyNames->name), "() { [native code] }"_s) };
    if (object->isErrorInstance() || className == "DOMException"_s)
        return { "error"_s, describeError(realm, object, className) };
    if (object->inherits<JSArray>() || TypeInfo::isArgumentsType(object->type()))
        return { "array"_s, withLength() };
    for (auto list : { "NodeList"_s, "RadioNodeList"_s, "HTMLCollection"_s, "HTMLAllCollection"_s, "HTMLFormControlsCollection"_s, "HTMLOptionsCollection"_s, "DOMTokenList"_s }) {
        if (className == list)
            return { "array"_s, withLength() };
    }
    if (auto* date = dynamicDowncast<DateInstance>(object)) {
        auto time = date->gregorianDateTime(vm.dateCache);
        return { "date"_s, time ? formatDateTime(time, DateTimeFormat::DateAndTime, false, vm.dateCache) : "Invalid Date"_s };
    }
    if (auto* regExp = dynamicDowncast<RegExpObject>(object))
        return { "regexp"_s, regExp->regExp()->toSourceString() };
    if (auto* map = dynamicDowncast<JSMap>(object))
        return { "map"_s, sized(map->size()) };
    if (auto* set = dynamicDowncast<JSSet>(object))
        return { "set"_s, sized(set->size()) };
    if (object->inherits<JSWeakMap>())
        return { "weakmap"_s, className };
    if (object->inherits<JSWeakSet>())
        return { "weakset"_s, className };
    if (object->inherits<JSMapIterator>())
        return { "iterator"_s, "MapIterator"_s };
    if (object->inherits<JSSetIterator>())
        return { "iterator"_s, "SetIterator"_s };
    if (object->inherits<JSGenerator>() || object->inherits<JSAsyncGenerator>())
        return { "generator"_s, className };
    if (object->inherits<JSPromise>())
        return { "promise"_s, className };
    if (auto* view = dynamicDowncast<JSDataView>(object))
        return { "dataview"_s, sized(view->byteLength()) };
    if (auto* view = dynamicDowncast<JSArrayBufferView>(object))
        return { "typedarray"_s, sized(view->length()) };
    if (auto* buffer = dynamicDowncast<JSArrayBuffer>(object))
        return { "arraybuffer"_s, sized(buffer->impl()->byteLength()) };
    return { {}, className };
}

// The subtype, the name of the class and the description.
extern "C" void Bun__Inspector__describe(JSGlobalObject* realm, EncodedJSValue value, BunString* texts)
{
    JSObject* object = asObject(JSValue::decode(value));
    String className = object->type() == ProxyObjectType ? "Object"_s : JSObject::calculatedClassName(object);
    auto [subtype, description] = subtypeAndDescription(realm, object, className);
    texts[0] = Bun::toStringRef(String(subtype)).leak();
    texts[1] = Bun::toStringRef(className).leak();
    texts[2] = Bun::toStringRef(description).leak();
}

// `Trait` in mirror.rs
enum Trait : int32_t {
    Enumerable = 1,
    Configurable = 2,
    Writable = 4,
    Own = 8,
    HasValue = 16,
    Accessor = 32,
    Thrown = 64,
    Private = 128,
    Index = 256,
};

struct Wanted {
    bool ownOnly;
    bool accessorsOnly;
    bool skipsIndices;
    // Of each object of the prototype chain.
    uint32_t most;
};

// The key, the traits, the value, the getter and the setter of each.
extern "C" EncodedJSValue Bun__Inspector__properties(JSGlobalObject* realm, EncodedJSValue value, Wanted wanted)
{
    VM& vm = realm->vm();
    JSObject* receiver = JSValue::decode(value).getObject();
    MarkedArgumentBuffer all;
    UncheckedKeyHashSet<RefPtr<UniquedStringImpl>> seen;
    for (JSObject* object = receiver; object && object->type() != ProxyObjectType; object = wanted.ownOnly ? nullptr : prototypeOf(realm, object)) {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        bool isOwn = object == receiver;
        bool isPlain = !object->structure()->typeInfo().overridesGetOwnPropertyNames();
        PropertyNameArrayBuilder names(vm, PropertyNameMode::StringsAndSymbols, isOwn && isPlain && !object->structure()->isCompiledStructure() ? PrivateSymbolMode::Include : PrivateSymbolMode::Exclude);
        bool hasManyIndices = object->inherits<JSArray>() || object->inherits<JSArrayBufferView>();
        bool hidesStack = isYetToBeFormatted(vm, object);
        if (hidesStack)
            object->structure()->getPropertyNamesFromStructure(vm, names, DontEnumPropertiesMode::Include);
        else if (hasManyIndices && (wanted.skipsIndices || wanted.most != UINT32_MAX)) {
            uint64_t length = object->inherits<JSArray>() ? uncheckedDowncast<JSArray>(object)->length() : object->inherits<JSDataView>() ? 0
                                                                                                                                          : uncheckedDowncast<JSArrayBufferView>(object)->length();
            for (uint32_t index = 0; !wanted.skipsIndices && index < length && index < wanted.most; index++)
                names.add(Identifier::from(vm, index));
            object->getOwnNonIndexPropertyNames(realm, names, DontEnumPropertiesMode::Include);
        } else
            object->methodTable()->getOwnPropertyNames(object, realm, names, DontEnumPropertiesMode::Include);
        if (scope.exception()) {
            (void)scope.clearExceptionExceptTermination();
            break;
        }
        uint32_t count = 0;
        for (auto& name : names) {
            bool isIndex = !name.isSymbol() && parseIndex(name);
            if ((name.isPrivateName() && !name.string().startsWith('#')) || (isIndex && wanted.skipsIndices) || (hidesStack && name == vm.propertyNames->stack) || !seen.add(name.impl()).isNewEntry)
                continue;
            if (count++ >= wanted.most && !hasManyIndices)
                break;
            PropertyDescriptor descriptor;
            bool exists = name.isPrivateName() || object->getOwnPropertyDescriptor(realm, name, descriptor);
            int32_t traits = (isOwn ? Own : 0) | (isIndex ? Index : 0);
            JSValue found, getter = jsUndefined(), setter = jsUndefined();
            if (auto* exception = scope.exception()) {
                found = exception->value();
                traits |= Thrown;
                if (!scope.clearExceptionExceptTermination())
                    return {};
            } else if (!exists)
                continue;
            else if (name.isPrivateName()) {
                found = object->getDirect(vm, name);
                traits |= Private;
            } else {
                traits |= (descriptor.enumerable() ? Enumerable : 0) | (descriptor.configurable() ? Configurable : 0);
                if (descriptor.isAccessorDescriptor()) {
                    getter = descriptor.getterPresent() ? descriptor.getter() : jsUndefined();
                    setter = descriptor.setterPresent() ? descriptor.setter() : jsUndefined();
                    found = callNativeGetter(realm, getter, receiver);
                    traits |= Accessor | (setter.isObject() ? Writable : 0);
                } else {
                    found = descriptor.value();
                    traits |= descriptor.writable() ? Writable : 0;
                }
            }
            if (wanted.accessorsOnly && !(traits & Accessor))
                continue;
            bool isSymbol = name.isSymbol() && !name.isPrivateName();
            all.append(isSymbol ? JSValue(Symbol::create(vm, static_cast<SymbolImpl&>(*name.impl()))) : JSValue(jsString(vm, name.string())));
            for (JSValue it : { jsNumber(traits | (found ? HasValue : 0)), found ? found : jsUndefined(), getter, setter })
                all.append(it);
        }
    }
    return listOf(realm, all);
}

// The name and the value of each internal slot.
extern "C" EncodedJSValue Bun__Inspector__slots(JSGlobalObject* realm, EncodedJSValue value)
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* object = asObject(JSValue::decode(value));
    MarkedArgumentBuffer all;
    auto add = [&](ASCIILiteral name, JSValue it) {
        all.append(jsString(vm, String(name)));
        all.append(it);
    };
    if (auto* promise = dynamicDowncast<JSPromise>(object)) {
        auto status = promise->status();
        add("[[PromiseState]]"_s, jsString(vm, String(status == JSPromise::Status::Pending ? "pending"_s : status == JSPromise::Status::Fulfilled ? "fulfilled"_s
                                                                                                                                                  : "rejected"_s)));
        add("[[PromiseResult]]"_s, promise->result());
    } else if (auto* proxy = dynamicDowncast<ProxyObject>(object)) {
        add("[[Handler]]"_s, proxy->handler());
        add("[[Target]]"_s, proxy->isRevoked() ? jsNull() : JSValue(proxy->target()));
        add("[[IsRevoked]]"_s, jsBoolean(proxy->isRevoked()));
    } else if (auto* bound = dynamicDowncast<JSBoundFunction>(object)) {
        add("[[TargetFunction]]"_s, bound->targetFunction());
        add("[[BoundThis]]"_s, bound->boundThis());
        JSValue arguments = bound->boundArgsCopy(realm);
        RETURN_IF_EXCEPTION(scope, {});
        add("[[BoundArgs]]"_s, arguments);
    } else if (auto* reference = dynamicDowncast<JSWeakObjectRef>(object)) {
        JSCell* target = reference->deref(vm);
        add("[[WeakRefTarget]]"_s, target ? JSValue(target) : jsUndefined());
    } else if (object->inherits<StringObject>() || object->inherits<NumberObject>() || object->inherits<BooleanObject>() || object->inherits<SymbolObject>() || object->inherits<BigIntObject>())
        add("[[PrimitiveValue]]"_s, uncheckedDowncast<JSWrapperObject>(object)->internalValue());
    if (JSObject* prototype = prototypeOf(realm, object))
        add("[[Prototype]]"_s, prototype);
    RELEASE_AND_RETURN(scope, listOf(realm, all));
}

// Objects with a `value`, and a `key` if there are keys. `undefined` if it is no collection.
extern "C" EncodedJSValue Bun__Inspector__entries(JSGlobalObject* realm, EncodedJSValue collection, uint32_t most)
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* object = asObject(JSValue::decode(collection));
    MarkedArgumentBuffer all, weak;
    auto add = [&](JSValue key, JSValue value) {
        JSObject* entry = constructEmptyObject(vm, realm->nullPrototypeObjectStructure());
        if (key)
            entry->putDirect(vm, Identifier::fromString(vm, "key"_s), key);
        entry->putDirect(vm, vm.propertyNames->value, value);
        all.append(entry);
    };
    JSValue key, value;
    if (auto* map = dynamicDowncast<JSMap>(object)) {
        auto* iterator = JSMapIterator::create(vm, realm->mapIteratorStructure(), map, IterationKind::Entries);
        RETURN_IF_EXCEPTION(scope, {});
        while (all.size() < most && iterator->nextKeyValue(realm, key, value))
            add(key, value);
    } else if (auto* set = dynamicDowncast<JSSet>(object)) {
        auto* iterator = JSSetIterator::create(vm, realm->setIteratorStructure(), set, IterationKind::Keys);
        RETURN_IF_EXCEPTION(scope, {});
        while (all.size() < most && iterator->next(realm, value))
            add({}, value);
    } else if (auto* weakMap = dynamicDowncast<JSWeakMap>(object)) {
        weakMap->takeSnapshot(weak, most);
        for (size_t at = 0; at + 1 < weak.size(); at += 2)
            add(weak.at(at), weak.at(at + 1));
    } else if (auto* weakSet = dynamicDowncast<JSWeakSet>(object)) {
        weakSet->takeSnapshot(weak, most);
        for (size_t at = 0; at < weak.size(); at++)
            add({}, weak.at(at));
    } else
        return JSValue::encode(jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, listOf(realm, all));
}

// The script, the line and the column, from 0.
extern "C" bool Bun__Inspector__placeOfFunction(EncodedJSValue value, uint32_t* place)
{
    auto* function = dynamicDowncast<JSFunction>(JSValue::decode(value));
    while (auto* bound = dynamicDowncast<JSBoundFunction>(function))
        function = dynamicDowncast<JSFunction>(bound->targetFunction());
    const SourceCode* source = function && !function->isHostOrBuiltinFunction() ? function->sourceCode() : nullptr;
    if (!source || !source->provider())
        return false;
    place[0] = source->provider()->asID();
    place[1] = source->firstLine().zeroBasedInt();
    place[2] = source->startColumn().zeroBasedInt();
    return true;
}

extern "C" EncodedJSValue Bun__Inspector__refusal(JSGlobalObject* realm)
{
    return JSValue::encode(createEvalError(realm, "Possible side-effect in debug-evaluate"_s));
}

// The function, the URL, the script, the line and the column of each frame. See `stackOf`. It does not throw.
extern "C" EncodedJSValue Bun__Inspector__stack(JSGlobalObject* realm, EncodedJSValue thrown, uint32_t most)
{
    VM& vm = realm->vm();
    MarkedArgumentBuffer all;
    for (auto& frame : stackOf(realm, JSValue::decode(thrown), most + 2)) {
        if (all.size() == most * 5)
            break;
        if (!frame.hasLineAndColumnInfo() || (frame.codeBlock() && !isDesktopRealm(frame.codeBlock()->globalObject())))
            continue;
        String url = Zig::sourceURL(vm, frame);
        if (url.startsWith("internal:"_s) || url.startsWith("node:"_s))
            continue;
        String name = frame.functionName(vm);
        bool isTopLevel = name == "global code"_s || name == "module code"_s || name == "eval code"_s;
        auto [line, column] = placeOf(frame);
        for (JSValue it : { JSValue(jsString(vm, isTopLevel ? emptyString() : name)), JSValue(jsString(vm, url)), jsNumber(static_cast<uint32_t>(frame.sourceID())), jsNumber(line ? line - 1 : 0), jsNumber(column ? column - 1 : 0) })
            all.append(it);
    }
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    EncodedJSValue list = listOf(realm, all);
    if (!scope.exception())
        return list;
    (void)scope.clearExceptionExceptTermination();
    return encodedJSUndefined();
}

// What stands for an object in a message that nobody has seen yet.
extern "C" EncodedJSValue Bun__Inspector__brief(JSGlobalObject* realm, EncodedJSValue value)
{
    VM& vm = realm->vm();
    JSObject* object = asObject(JSValue::decode(value));
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* error = dynamicDowncast<ErrorInstance>(object);
    String text = error ? error->sanitizedToString(realm) : object->type() == ProxyObjectType ? "Object"_s
                                                                                              : JSObject::calculatedClassName(object);
    if (scope.exception())
        (void)scope.clearExceptionExceptTermination();
    return JSValue::encode(jsString(vm, text.isNull() ? emptyString() : text));
}

static String syntaxErrorIn(VM& vm, const String& source, uint32_t* line)
{
    ParserError error;
    if (isFeatureRemoved(RemovableFeature::Interpreter) || checkSyntax(vm, makeSource(source, SourceOrigin {}, SourceTaintedOrigin::Untainted), error))
        return String();
    *line = error.line() > 0 ? error.line() - 1 : 0;
    // The console goes by this text to tell that there is more to come.
    bool isIncomplete = error.syntaxErrorType() == ParserError::SyntaxErrorRecoverable || error.token().m_type == UNTERMINATED_TEMPLATE_LITERAL_ERRORTOK;
    return isIncomplete ? "Unexpected end of input"_s : error.message();
}

extern "C" BunString Bun__Inspector__syntaxError(JSGlobalObject* realm, const BunString* source, uint32_t* line)
{
    return Bun::toStringRef(syntaxErrorIn(realm->vm(), source->toWTFString(), line)).leak();
}

// What is evaluated until this is called without `helpers` finds them, and may declare what has been declared.
extern "C" void Bun__Inspector__useConsole(JSGlobalObject* realm, EncodedJSValue helpers, bool redeclares)
{
    VM& vm = realm->vm();
    vm.setAllowRedeclaringSymbols(redeclares);
    if (JSObject* object = JSValue::decode(helpers).getObject())
        realm->setGlobalScopeExtension(JSWithScope::create(vm, realm, realm->globalScope(), object));
    else
        realm->clearGlobalScopeExtension();
}

}
