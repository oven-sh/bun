#include "root.h"
#include "JSMIMEParams.h"

#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSMapIterator.h"
#include "JavaScriptCore/InternalFunction.h"
#include "JavaScriptCore/JSCJSValueInlines.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/StructureInlines.h"
#include "JavaScriptCore/IteratorOperations.h"
#include "JavaScriptCore/PropertySlot.h"
#include "JavaScriptCore/SlotVisitorMacros.h"
#include "JavaScriptCore/SubspaceInlines.h"
#include "wtf/text/StringBuilder.h"
#include "wtf/text/WTFString.h"
#include "wtf/ASCIICType.h"
#include "ZigGlobalObject.h"
#include "NodeValidator.h" // For Bun::V::
#include "ErrorCode.h" // For Bun::ERR::
#include "JavaScriptCore/JSMapInlines.h"

namespace WebCore {

using namespace JSC;
using namespace WTF;

//-- Helper Functions (Adapted from mime.ts & HTTPParsers.h) --

// Checks if a character is an HTTP token code point.
// Equivalent to /[^!#$%&'*+\-.^_`|~A-Za-z0-9]/
static inline bool isHTTPTokenChar(char c)
{
    return WTF::isASCIIAlphanumeric(c) || c == '!' || c == '#' || c == '$' || c == '%' || c == '&' || c == '\'' || c == '*' || c == '+' || c == '-' || c == '.' || c == '^' || c == '_' || c == '`' || c == '|' || c == '~';
}

// Finds the first character that is NOT an HTTP token code point. Returns -1 if all are valid.
static int findFirstInvalidHTTPTokenChar(const StringView& view)
{
    if (view.is8Bit()) {
        const auto span = view.span8();
        for (size_t i = 0; i < span.size(); ++i) {
            if (!isHTTPTokenChar(span[i])) {
                return i;
            }
        }
    } else {
        const auto span = view.span16();
        for (size_t i = 0; i < span.size(); ++i) {
            // Assume non-ASCII is invalid for tokens
            if (span[i] > 0x7F || !isHTTPTokenChar(static_cast<char>(span[i]))) {
                return i;
            }
        }
    }
    return -1;
}

// Checks if a character is valid within an HTTP quoted string value (excluding DQUOTE and backslash).
// Equivalent to /[^\t\u0020-\u007E\u0080-\u00FF]/, but we handle quotes/backslash separately.
static inline bool isHTTPQuotedStringChar(char16_t c)
{
    return c == 0x09 || (c >= 0x20 && c <= 0x7E) || (c >= 0x80 && c <= 0xFF);
}

// Finds the first invalid character in a potential parameter value. Returns -1 if all are valid.
static int findFirstInvalidHTTPQuotedStringChar(const StringView& view)
{
    if (view.is8Bit()) {
        const auto span = view.span8();
        for (size_t i = 0; i < span.size(); ++i) {
            if (!isHTTPQuotedStringChar(span[i])) {
                return i;
            }
        }
    } else {
        const auto span = view.span16();
        for (size_t i = 0; i < span.size(); ++i) {
            if (!isHTTPQuotedStringChar(span[i])) {
                return i;
            }
        }
    }
    return -1;
}

// Equivalent to /[^\r\n\t ]|$/
static size_t findEndBeginningWhitespace(const StringView& view)
{
    if (view.is8Bit()) {
        const auto span = view.span8();
        for (size_t i = 0; i < span.size(); ++i) {
            char c = span[i];
            if (c != '\t' && c != ' ' && c != '\r' && c != '\n') {
                return i;
            }
        }
        return span.size();
    } else {
        const auto span = view.span16();
        for (size_t i = 0; i < span.size(); ++i) {
            char16_t c = span[i];
            if (c != '\t' && c != ' ' && c != '\r' && c != '\n') {
                return i;
            }
        }
        return span.size();
    }
}

// Equivalent to /[\r\n\t ]*$/
static size_t findStartEndingWhitespace(const StringView& view)
{
    if (view.is8Bit()) {
        const auto span = view.span8();
        for (size_t i = span.size(); i > 0; --i) {
            char c = span[i - 1];
            if (c != '\t' && c != ' ' && c != '\r' && c != '\n') {
                return i;
            }
        }
        return 0;
    } else {
        const auto span = view.span16();
        for (size_t i = span.size(); i > 0; --i) {
            char16_t c = span[i - 1];
            if (c != '\t' && c != ' ' && c != '\r' && c != '\n') {
                return i;
            }
        }
        return 0;
    }
}

static String removeBackslashes(const StringView& view)
{
    if (view.find('\\') == notFound) {
        return view.toString();
    }

    StringBuilder builder;
    if (view.is8Bit()) {
        auto span = view.span8();
        for (size_t i = 0; i < span.size(); ++i) {
            LChar c = span[i];
            if (c == '\\' && i + 1 < span.size()) {
                builder.append(span[++i]);
            } else {
                builder.append(c);
            }
        }
    } else {
        auto span = view.span16();
        for (size_t i = 0; i < span.size(); ++i) {
            char16_t c = span[i];
            if (c == '\\' && i + 1 < span.size()) {
                builder.append(span[++i]);
            } else {
                builder.append(c);
            }
        }
    }
    return builder.toString();
}

static void escapeQuoteOrBackslash(const StringView& view, StringBuilder& builder)
{
    if (view.find([](char16_t c) { return c == '"' || c == '\\'; }) == notFound) {
        builder.append(view);
        return;
    }

    if (view.is8Bit()) {
        auto span = view.span8();
        for (LChar c : span) {
            if (c == '"' || c == '\\') {
                builder.append('\\');
            }
            builder.append(c);
        }
    } else {
        auto span = view.span16();
        for (char16_t c : span) {
            if (c == '"' || c == '\\') {
                builder.append('\\');
            }
            builder.append(c);
        }
    }
}

// Encodes a parameter value for serialization.
static void encodeParamValue(const StringView& value, StringBuilder& builder)
{
    if (value.isEmpty()) {
        builder.append("\"\""_s);
        return;
    }
    if (findFirstInvalidHTTPTokenChar(value) == -1) {
        // It's a simple token, no quoting needed.
        builder.append(value);
        return;
    }
    // Needs quoting and escaping.
    builder.append('"');
    escapeQuoteOrBackslash(value, builder);
    builder.append('"');
}

// Parses the parameter string and populates the map.
// Returns true on success, false on failure (exception should be set).
bool parseMIMEParamsString(JSGlobalObject* globalObject, JSMap* map, StringView input)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    size_t position = 0;
    size_t length = input.length();

    while (position < length) {
        // Skip whitespace and the semicolon separator
        position += findEndBeginningWhitespace(input.substring(position));
        if (position >= length) break; // End of string after whitespace

        // Find the end of the parameter name (next ';' or '=')
        size_t nameEnd = position;
        while (nameEnd < length) {
            char16_t c = input[nameEnd];
            if (c == ';' || c == '=') break;
            nameEnd++;
        }

        StringView nameView = input.substring(position, nameEnd - position);
        String name = nameView.convertToASCIILowercase();
        position = nameEnd;

        StringView valueView;
        String valueStr;

        // Check if there's a value part (an '=' sign)
        if (position < length && input[position] == '=') {
            position++; // Skip '='

            if (position < length && input[position] == '"') {
                // Quoted string value
                position++; // Skip opening quote
                size_t valueStart = position;
                bool escaped = false;
                while (position < length) {
                    char16_t c = input[position];
                    if (escaped) {
                        escaped = false;
                    } else if (c == '\\') {
                        escaped = true;
                    } else if (c == '"') {
                        break; // Found closing quote
                    }
                    position++;
                }
                valueView = input.substring(valueStart, position - valueStart);
                valueStr = removeBackslashes(valueView);

                if (position < length && input[position] == '"') {
                    position++; // Skip closing quote
                } else {
                    // Node.js behavior seems to allow this, just consuming until the end or next semicolon
                    valueStr = removeBackslashes(valueView);
                    size_t semicolonPos = input.find(';', position);
                    position = (semicolonPos == notFound) ? length : semicolonPos;
                }
            } else {
                // Token value (potentially empty)
                size_t valueEnd = position;
                while (valueEnd < length && input[valueEnd] != ';') {
                    valueEnd++;
                }
                valueView = input.substring(position, valueEnd - position);
                // Trim trailing whitespace
                size_t trimmedEnd = findStartEndingWhitespace(valueView);
                valueStr = valueView.substring(0, trimmedEnd).toString();
                position = valueEnd;
                if (valueStr.isEmpty()) {
                    continue; // skip adding this parameter
                }
            }
        } else {
            // Parameter name without a value (e.g., ";foo;") - Node ignores these.
            // Skip until the next semicolon or end of string.
            size_t semicolonPos = input.find(';', position);
            position = (semicolonPos == notFound) ? length : semicolonPos;
            // Skip the potential ';'
            if (position < length && input[position] == ';') position++;
            continue; // Skip adding this parameter
        }

        // Validate name and value according to HTTP token/quoted-string rules
        int invalidNameIndex = findFirstInvalidHTTPTokenChar(name);
        if (name.isEmpty() || invalidNameIndex != -1) {
            // invalid name
            continue; // skip adding this parameter
        }

        int invalidValueIndex = findFirstInvalidHTTPQuotedStringChar(valueStr);
        if (invalidValueIndex != -1) {
            // invalid value
            continue; // skip adding this parameter
        }

        // Add to map only if the name doesn't exist yet (first one wins)
        JSValue nameJS = jsString(vm, name);
        if (!map->has(globalObject, nameJS)) {
            map->set(globalObject, nameJS, jsString(vm, valueStr));
            RETURN_IF_EXCEPTION(scope, false);
        }

        // Skip the potential trailing semicolon
        if (position < length && input[position] == ';') {
            position++;
        }
    }

    return true;
}

//-- JSMIMEParams (Instance) Implementation --

const ClassInfo JSMIMEParams::s_info = { "MIMEParams"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSMIMEParams) };

JSMIMEParams* JSMIMEParams::create(VM& vm, Structure* structure, JSMap* map)
{
    JSMIMEParams* instance = new (NotNull, allocateCell<JSMIMEParams>(vm)) JSMIMEParams(vm, structure);
    instance->finishCreation(vm, map);
    return instance;
}

Structure* JSMIMEParams::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSMIMEParams::JSMIMEParams(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSMIMEParams::finishCreation(VM& vm, JSMap* map)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_map.set(vm, this, map);
}

template<typename Visitor>
void JSMIMEParams::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSMIMEParams* thisObject = jsCast<JSMIMEParams*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_map);
}

DEFINE_VISIT_CHILDREN(JSMIMEParams);

//-- JSMIMEParamsPrototype Implementation --

const ClassInfo JSMIMEParamsPrototype::s_info = { "MIMEParams"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSMIMEParamsPrototype) };

JSMIMEParamsPrototype* JSMIMEParamsPrototype::create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
{
    JSMIMEParamsPrototype* prototype = new (NotNull, allocateCell<JSMIMEParamsPrototype>(vm)) JSMIMEParamsPrototype(vm, structure);
    prototype->finishCreation(vm);
    return prototype;
}

Structure* JSMIMEParamsPrototype::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSMIMEParamsPrototype::JSMIMEParamsPrototype(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

// Host function implementations
JSC_DEFINE_HOST_FUNCTION(jsMIMEParamsProtoFuncGet, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // 1. Get this value
    auto* thisObject = jsDynamicCast<JSMIMEParams*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        scope.throwException(globalObject, Bun::createInvalidThisError(globalObject, thisObject, "MIMEParams"));
        RETURN_IF_EXCEPTION(scope, {});
    }

    // 2. Get argument
    JSValue nameValue = callFrame->argument(0);
    String name = nameValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    // 3. Perform operation on the map
    JSMap* map = thisObject->jsMap();
    if (!map->has(globalObject, jsString(vm, name))) {
        return JSValue::encode(jsNull());
    }
    JSValue result = map->get(globalObject, jsString(vm, name));
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    // 4. Return result (null if not found)
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsMIMEParamsProtoFuncHas, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSMIMEParams*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        scope.throwException(globalObject, Bun::createInvalidThisError(globalObject, thisObject, "MIMEParams"));
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSValue nameValue = callFrame->argument(0);
    String name = nameValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    JSMap* map = thisObject->jsMap();
    bool result = map->has(globalObject, jsString(vm, name));
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    return JSValue::encode(jsBoolean(result));
}

JSC_DEFINE_HOST_FUNCTION(jsMIMEParamsProtoFuncSet, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSMIMEParams*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        scope.throwException(globalObject, Bun::createInvalidThisError(globalObject, thisObject, "MIMEParams"));
        RETURN_IF_EXCEPTION(scope, {});
    }

    // 1. Validate Arguments
    JSValue nameValue = callFrame->argument(0);
    JSValue valueValue = callFrame->argument(1);

    String nameStr = nameValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    String valueStr = valueValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Validate name (must be a valid HTTP token)
    int invalidNameIndex = findFirstInvalidHTTPTokenChar(nameStr);
    if (nameStr.isEmpty() || invalidNameIndex != -1) {
        scope.release();
        return Bun::ERR::INVALID_MIME_SYNTAX(scope, globalObject, "parameter name"_s, nameStr, invalidNameIndex);
    }

    // Validate value (must contain only valid quoted-string characters)
    int invalidValueIndex = findFirstInvalidHTTPQuotedStringChar(valueStr);
    if (invalidValueIndex != -1) {
        scope.release();
        return Bun::ERR::INVALID_MIME_SYNTAX(scope, globalObject, "parameter value"_s, valueStr, invalidValueIndex);
    }

    // 2. Perform Set Operation
    JSMap* map = thisObject->jsMap();
    map->set(globalObject, jsString(vm, nameStr), jsString(vm, valueStr));
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsMIMEParamsProtoFuncDelete, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSMIMEParams*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        scope.throwException(globalObject, Bun::createInvalidThisError(globalObject, thisObject, "MIMEParams"));
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSValue nameValue = callFrame->argument(0);
    String name = nameValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    JSMap* map = thisObject->jsMap();
    map->remove(globalObject, jsString(vm, name));
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsMIMEParamsProtoFuncToString, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSMIMEParams*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        scope.throwException(globalObject, Bun::createInvalidThisError(globalObject, thisObject, "MIMEParams"));
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSMap* map = thisObject->jsMap();
    StringBuilder builder;
    bool first = true;

    JSValue iteratorValue = JSMapIterator::create(globalObject, globalObject->mapIteratorStructure(), map, IterationKind::Entries);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());
    JSMapIterator* iterator = jsDynamicCast<JSMapIterator*>(iteratorValue);
    if (!iterator) { // Should not happen for JSMap.entries()
        scope.release();
        return Bun::ERR::INVALID_MIME_SYNTAX(scope, globalObject, "Internal error: Expected MapIterator"_s, "toString"_s, -1);
    }

    while (true) {
        JSValue nextValue;
        if (!iterator->next(globalObject, nextValue)) break;

        JSArray* entry = jsDynamicCast<JSArray*>(nextValue);
        if (!entry || entry->length() < 2) // Should not happen
            continue;

        JSValue keyJS = entry->getIndex(globalObject, 0);
        JSValue valueJS = entry->getIndex(globalObject, 1);

        // Key should already be lowercase string from set/constructor
        String key = keyJS.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, encodedJSValue());
        String value = valueJS.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, encodedJSValue());

        if (!first) {
            builder.append(';');
        }
        first = false;

        builder.append(key);
        builder.append('=');
        encodeParamValue(value, builder);
    }

    return JSValue::encode(jsString(vm, builder.toString()));
}

JSC_DEFINE_HOST_FUNCTION(jsMIMEParamsProtoFuncEntries, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* thisObject = jsDynamicCast<JSMIMEParams*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        scope.throwException(globalObject, Bun::createInvalidThisError(globalObject, thisObject, "MIMEParams"));
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(JSMapIterator::create(globalObject, globalObject->mapIteratorStructure(), thisObject->jsMap(), IterationKind::Entries));
}

JSC_DEFINE_HOST_FUNCTION(jsMIMEParamsProtoFuncKeys, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* thisObject = jsDynamicCast<JSMIMEParams*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        scope.throwException(globalObject, Bun::createInvalidThisError(globalObject, thisObject, "MIMEParams"));
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(JSMapIterator::create(globalObject, globalObject->mapIteratorStructure(), thisObject->jsMap(), IterationKind::Keys));
}

JSC_DEFINE_HOST_FUNCTION(jsMIMEParamsProtoFuncValues, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* thisObject = jsDynamicCast<JSMIMEParams*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        scope.throwException(globalObject, Bun::createInvalidThisError(globalObject, thisObject, "MIMEParams"));
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(JSMapIterator::create(globalObject, globalObject->mapIteratorStructure(), thisObject->jsMap(), IterationKind::Values));
}

// Forward declare constructor functions
JSC_DECLARE_HOST_FUNCTION(callMIMEParams);
JSC_DECLARE_HOST_FUNCTION(constructMIMEParams);

// Define the properties and functions on the prototype
static const HashTableValue JSMIMEParamsPrototypeTableValues[] = {
    { "get"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMIMEParamsProtoFuncGet, 1 } },
    { "has"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMIMEParamsProtoFuncHas, 1 } },
    { "set"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMIMEParamsProtoFuncSet, 2 } },
    { "delete"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMIMEParamsProtoFuncDelete, 1 } },
    { "toString"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMIMEParamsProtoFuncToString, 0 } },
    { "entries"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMIMEParamsProtoFuncEntries, 0 } },
    { "keys"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMIMEParamsProtoFuncKeys, 0 } },
    { "values"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMIMEParamsProtoFuncValues, 0 } },
};

void JSMIMEParamsPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSMIMEParams::info(), JSMIMEParamsPrototypeTableValues, *this);

    // Set [Symbol.iterator] to entries
    putDirectWithoutTransition(vm, vm.propertyNames->iteratorSymbol, getDirect(vm, Identifier::fromString(vm, "entries"_s)), PropertyAttribute::DontEnum | 0);

    // Set toJSON to toString
    putDirectWithoutTransition(vm, vm.propertyNames->toJSON, getDirect(vm, vm.propertyNames->toString), PropertyAttribute::Function | 0);

    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

//-- JSMIMEParamsConstructor Implementation --

const ClassInfo JSMIMEParamsConstructor::s_info = { "MIMEParams"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSMIMEParamsConstructor) };

JSMIMEParamsConstructor* JSMIMEParamsConstructor::create(VM& vm, Structure* structure, JSObject* prototype)
{
    JSMIMEParamsConstructor* constructor = new (NotNull, JSC::allocateCell<JSMIMEParamsConstructor>(vm)) JSMIMEParamsConstructor(vm, structure);
    constructor->finishCreation(vm, prototype);
    return constructor;
}

Structure* JSMIMEParamsConstructor::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
}

JSMIMEParamsConstructor::JSMIMEParamsConstructor(VM& vm, Structure* structure)
    : Base(vm, structure, callMIMEParams, constructMIMEParams)
{
}

JSC_DEFINE_HOST_FUNCTION(callMIMEParams, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return throwVMError(globalObject, scope, createNotAConstructorError(globalObject, callFrame->jsCallee()));
}

JSC_DEFINE_HOST_FUNCTION(constructMIMEParams, (JSGlobalObject * globalObject, CallFrame* callFrame))
{

    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSC::Structure* structure = zigGlobalObject->m_JSMIMEParamsClassStructure.get(zigGlobalObject);

    JSC::JSValue newTarget = callFrame->newTarget();
    if (zigGlobalObject->m_JSMIMEParamsClassStructure.constructor(zigGlobalObject) != newTarget) [[unlikely]] {
        if (!newTarget) {
            throwTypeError(globalObject, scope, "Class constructor MIMEParams cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = JSC::InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(), functionGlobalObject->m_JSMIMEParamsClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Create the internal JSMap
    JSMap* map = JSMap::create(vm, globalObject->mapStructure());
    RETURN_IF_EXCEPTION(scope, {}); // OOM check

    // Create the JSMIMEParams instance
    JSMIMEParams* instance = JSMIMEParams::create(vm, structure, map);

    return JSC::JSValue::encode(instance);
}

void JSMIMEParamsConstructor::finishCreation(VM& vm, JSObject* prototype)
{
    Base::finishCreation(vm, 0, "MIMEParams"_s);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
}

//-- Structure Setup --

void setupJSMIMEParamsClassStructure(LazyClassStructure::Initializer& init)
{
    VM& vm = init.vm;
    JSGlobalObject* globalObject = init.global;

    // Create Prototype
    auto* prototypeStructure = JSMIMEParamsPrototype::createStructure(vm, globalObject, globalObject->objectPrototype());
    auto* prototype = JSMIMEParamsPrototype::create(vm, globalObject, prototypeStructure);

    // Create Constructor
    auto* constructorStructure = JSMIMEParamsConstructor::createStructure(vm, globalObject, globalObject->functionPrototype());
    auto* constructor = JSMIMEParamsConstructor::create(vm, constructorStructure, prototype);

    // Create Instance Structure
    auto* instanceStructure = JSMIMEParams::createStructure(vm, globalObject, prototype);

    init.setPrototype(prototype);
    init.setStructure(instanceStructure);
    init.setConstructor(constructor);
}

JSValue createJSMIMEBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    JSObject* obj = constructEmptyObject(globalObject);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "MIMEParams"_s)),
        globalObject->m_JSMIMEParamsClassStructure.constructor(globalObject));
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "MIMEType"_s)),
        globalObject->m_JSMIMETypeClassStructure.constructor(globalObject));

    return obj;
}

} // namespace WebCore
