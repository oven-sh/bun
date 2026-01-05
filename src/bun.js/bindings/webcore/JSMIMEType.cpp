#include "root.h"
#include "JSMIMEType.h"

#include "JSMIMEParams.h" // For JSMIMEParams and helper functions
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSCJSValueInlines.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/StructureInlines.h"
#include "JavaScriptCore/JSMap.h" // For map creation in constructor
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

// Helper functions - redeclared as static to avoid linker errors
// Checks if a character is an HTTP token code point.
// Equivalent to /[^!#$%&'*+\-.^_`|~A-Za-z0-9]/
static inline bool isHTTPTokenChar(char c)
{
    return WTF::isASCIIAlphanumeric(c) || c == '!' || c == '#' || c == '$' || c == '%' || c == '&' || c == '\'' || c == '*' || c == '+' || c == '-' || c == '.' || c == '^' || c == '_' || c == '`' || c == '|' || c == '~';
}

// Checks if a character is NOT an HTTP token code point.
static inline bool isNotHTTPTokenChar(char c)
{
    return !isHTTPTokenChar(c);
}

// Finds the first character that is NOT an HTTP token code point. Returns -1 if all are valid.
static int findFirstInvalidHTTPTokenChar(const StringView& view)
{
    if (view.is8Bit()) {
        const auto span = view.span8();
        for (size_t i = 0; i < span.size(); ++i) {
            if (isNotHTTPTokenChar(span[i])) {
                return i;
            }
        }
    } else {
        const auto span = view.span16();
        for (size_t i = 0; i < span.size(); ++i) {
            // Assume non-ASCII is invalid for tokens
            if (span[i] > 0x7F || isNotHTTPTokenChar(static_cast<char>(span[i]))) {
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

// Checks if a character is NOT a valid HTTP quoted string code point.
static inline bool isNotHTTPQuotedStringChar(char16_t c)
{
    return !isHTTPQuotedStringChar(c);
}

// Finds the first invalid character in a potential parameter value. Returns -1 if all are valid.
static int findFirstInvalidHTTPQuotedStringChar(const StringView& view)
{
    if (view.is8Bit()) {
        const auto span = view.span8();
        for (size_t i = 0; i < span.size(); ++i) {
            if (isNotHTTPQuotedStringChar(span[i])) {
                return i;
            }
        }
    } else {
        const auto span = view.span16();
        for (size_t i = 0; i < span.size(); ++i) {
            if (isNotHTTPQuotedStringChar(span[i])) {
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
            Latin1Character c = span[i];
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

static String escapeQuoteOrBackslash(const StringView& view)
{
    if (view.find([](char16_t c) { return c == '"' || c == '\\'; }) == notFound) {
        return view.toString();
    }

    StringBuilder builder;
    if (view.is8Bit()) {
        auto span = view.span8();
        for (Latin1Character c : span) {
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
    return builder.toString();
}

// Encodes a parameter value for serialization.
static String encodeParamValue(const StringView& value)
{
    if (value.isEmpty()) {
        return "\"\""_s;
    }
    if (findFirstInvalidHTTPTokenChar(value) == -1) {
        // It's a simple token, no quoting needed.
        return value.toString();
    }
    // Needs quoting and escaping.
    return makeString('"', escapeQuoteOrBackslash(value), '"');
}

// Helper to parse type/subtype
// Returns {type, subtype, parameters_start_index} or throws on error
static std::tuple<String, String, size_t> parseTypeAndSubtype(JSGlobalObject* globalObject, GCOwnedDataScope<StringView>& input)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    size_t position = findEndBeginningWhitespace(input);
    size_t length = input->length();

    // Find end of type
    size_t typeEnd = input->find('/', position);
    if (typeEnd == notFound) {
        StringView remaining = input->substring(position);
        size_t invalidIndex = findFirstInvalidHTTPTokenChar(remaining);
        // Adjust index relative to original string
        size_t originalIndex = (invalidIndex == -1) ? notFound : position + invalidIndex;
        Bun::ERR::INVALID_MIME_SYNTAX(scope, globalObject, "type"_s, input->toString(), originalIndex);
        return {};
    }

    StringView typeView = input->substring(position, typeEnd - position);
    int invalidTypeIndex = findFirstInvalidHTTPTokenChar(typeView);
    if (typeView.isEmpty() || invalidTypeIndex != -1) {
        size_t originalIndex = (invalidTypeIndex == -1) ? position : position + invalidTypeIndex;
        Bun::ERR::INVALID_MIME_SYNTAX(scope, globalObject, "type"_s, input->toString(), originalIndex);
        return {};
    }
    String type = typeView.convertToASCIILowercase();
    position = typeEnd + 1; // Skip '/'

    // Find end of subtype
    size_t subtypeEnd = input->find(';', position);
    size_t paramsStartIndex;
    StringView rawSubtypeView;

    if (subtypeEnd == notFound) {
        rawSubtypeView = input->substring(position);
        paramsStartIndex = length; // Parameters start at the end if no ';'
    } else {
        rawSubtypeView = input->substring(position, subtypeEnd - position);
        paramsStartIndex = subtypeEnd + 1; // Parameters start after ';'
    }

    // Trim trailing whitespace from subtype
    size_t trimmedSubtypeEnd = findStartEndingWhitespace(rawSubtypeView);
    StringView subtypeView = rawSubtypeView.left(trimmedSubtypeEnd);

    int invalidSubtypeIndex = findFirstInvalidHTTPTokenChar(subtypeView);
    if (subtypeView.isEmpty() || invalidSubtypeIndex != -1) {
        size_t originalIndex = (invalidSubtypeIndex == -1) ? position : position + invalidSubtypeIndex;
        Bun::ERR::INVALID_MIME_SYNTAX(scope, globalObject, "subtype"_s, input->toString(), originalIndex);
        return {};
    }
    String subtype = subtypeView.convertToASCIILowercase();

    // Return type, subtype, and the index where parameters start
    return std::make_tuple(WTF::move(type), WTF::move(subtype), paramsStartIndex);
}

//-- JSMIMEType (Instance) Implementation --

const ClassInfo JSMIMEType::s_info = { "MIMEType"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSMIMEType) };

JSMIMEType* JSMIMEType::create(VM& vm, Structure* structure, String type, String subtype, JSMIMEParams* params)
{
    JSMIMEType* instance = new (NotNull, allocateCell<JSMIMEType>(vm)) JSMIMEType(vm, structure);
    instance->finishCreation(vm, WTF::move(type), WTF::move(subtype), params);
    return instance;
}

Structure* JSMIMEType::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSMIMEType::JSMIMEType(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSMIMEType::finishCreation(VM& vm, String type, String subtype, JSMIMEParams* params)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_type = WTF::move(type);
    m_subtype = WTF::move(subtype);
    m_parameters.set(vm, this, params);
}

template<typename Visitor>
void JSMIMEType::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSMIMEType* thisObject = jsCast<JSMIMEType*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_parameters);
    // m_type and m_subtype are WTF::String, not GC managed cells
}

DEFINE_VISIT_CHILDREN(JSMIMEType);

//-- JSMIMETypePrototype Implementation --

const ClassInfo JSMIMETypePrototype::s_info = { "MIMEType"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSMIMETypePrototype) };

JSMIMETypePrototype* JSMIMETypePrototype::create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
{
    JSMIMETypePrototype* prototype = new (NotNull, allocateCell<JSMIMETypePrototype>(vm)) JSMIMETypePrototype(vm, structure);
    prototype->finishCreation(vm);
    return prototype;
}

Structure* JSMIMETypePrototype::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSMIMETypePrototype::JSMIMETypePrototype(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

// Host function implementations
JSC_DEFINE_CUSTOM_GETTER(jsMIMETypeProtoGetterType, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSMIMEType*>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        scope.throwException(globalObject, Bun::createInvalidThisError(globalObject, thisObject, "MIMEType"));
        return {};
    }

    return JSValue::encode(jsString(vm, thisObject->type()));
}

JSC_DEFINE_CUSTOM_SETTER(jsMIMETypeProtoSetterType, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSMIMEType*>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        scope.throwException(globalObject, Bun::createInvalidThisError(globalObject, thisObject, "MIMEType"));
        return {};
    }

    JSValue value = JSValue::decode(encodedValue);
    String typeStr = value.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Validate type
    int invalidIndex = findFirstInvalidHTTPTokenChar(typeStr);
    if (typeStr.isEmpty() || invalidIndex != -1) {
        Bun::ERR::INVALID_MIME_SYNTAX(scope, globalObject, "type"_s, typeStr, invalidIndex);
        return {};
    }

    thisObject->setType(typeStr.convertToASCIILowercase());
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(jsMIMETypeProtoGetterSubtype, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSMIMEType*>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        scope.throwException(globalObject, Bun::createInvalidThisError(globalObject, thisObject, "MIMEType"));
        return {};
    }

    return JSValue::encode(jsString(vm, thisObject->subtype()));
}

JSC_DEFINE_CUSTOM_SETTER(jsMIMETypeProtoSetterSubtype, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSMIMEType*>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        scope.throwException(globalObject, Bun::createInvalidThisError(globalObject, thisObject, "MIMEType"));
        return {};
    }

    JSValue value = JSValue::decode(encodedValue);
    String subtypeStr = value.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Validate subtype
    int invalidIndex = findFirstInvalidHTTPTokenChar(subtypeStr);
    if (subtypeStr.isEmpty() || invalidIndex != -1) {
        Bun::ERR::INVALID_MIME_SYNTAX(scope, globalObject, "subtype"_s, subtypeStr, invalidIndex);
        return {};
    }

    thisObject->setSubtype(subtypeStr.convertToASCIILowercase());
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(jsMIMETypeProtoGetterEssence, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSMIMEType*>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        scope.throwException(globalObject, Bun::createInvalidThisError(globalObject, thisObject, "MIMEType"));
        return {};
    }

    String essence = makeString(thisObject->type(), '/', thisObject->subtype());
    return JSValue::encode(jsString(vm, essence));
}

JSC_DEFINE_CUSTOM_GETTER(jsMIMETypeProtoGetterParams, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSMIMEType*>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        scope.throwException(globalObject, Bun::createInvalidThisError(globalObject, thisObject, "MIMEType"));
        return {};
    }

    return JSValue::encode(thisObject->parameters());
}

JSC_DEFINE_HOST_FUNCTION(jsMIMETypeProtoFuncToString, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSMIMEType*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        scope.throwException(globalObject, Bun::createInvalidThisError(globalObject, thisObject, "MIMEType"));
        return {};
    }

    // Call the JSMIMEParams toString method
    JSValue paramsObject = thisObject->parameters();
    RETURN_IF_EXCEPTION(scope, {});

    MarkedArgumentBuffer args;
    JSValue paramsStrValue = paramsObject.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    String paramsStr = paramsStrValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    StringBuilder builder;
    builder.append(thisObject->type());
    builder.append('/');
    builder.append(thisObject->subtype());
    if (!paramsStr.isEmpty()) {
        builder.append(';');
        builder.append(paramsStr);
    }

    return JSValue::encode(jsString(vm, builder.toString()));
}

// Define the properties and functions on the prototype
static const HashTableValue JSMIMETypePrototypeValues[] = {
    { "type"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsMIMETypeProtoGetterType, jsMIMETypeProtoSetterType } },
    { "subtype"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsMIMETypeProtoGetterSubtype, jsMIMETypeProtoSetterSubtype } },
    { "essence"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsMIMETypeProtoGetterEssence, 0 } },
    { "params"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsMIMETypeProtoGetterParams, 0 } },
    { "toString"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMIMETypeProtoFuncToString, 0 } },
};

void JSMIMETypePrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);

    // Add regular methods
    reifyStaticProperties(vm, JSMIMEType::info(), JSMIMETypePrototypeValues, *this);

    // Set toJSON to toString
    putDirectWithoutTransition(vm, vm.propertyNames->toJSON, getDirect(vm, vm.propertyNames->toString), PropertyAttribute::Function | 0);

    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

//-- JSMIMETypeConstructor Implementation --

const ClassInfo JSMIMETypeConstructor::s_info = { "MIMEType"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSMIMETypeConstructor) };

JSMIMETypeConstructor* JSMIMETypeConstructor::create(VM& vm, Structure* structure, JSObject* prototype)
{
    JSMIMETypeConstructor* constructor = new (NotNull, JSC::allocateCell<JSMIMETypeConstructor>(vm)) JSMIMETypeConstructor(vm, structure);
    constructor->finishCreation(vm, prototype);
    return constructor;
}

Structure* JSMIMETypeConstructor::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
}

JSC_DECLARE_HOST_FUNCTION(callMIMEType);
JSC_DECLARE_HOST_FUNCTION(constructMIMEType);

JSMIMETypeConstructor::JSMIMETypeConstructor(VM& vm, Structure* structure)
    : Base(vm, structure, callMIMEType, constructMIMEType)
{
}

JSC_DEFINE_HOST_FUNCTION(callMIMEType, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return throwVMError(globalObject, scope, createNotAConstructorError(globalObject, callFrame->jsCallee()));
}

JSC_DEFINE_HOST_FUNCTION(constructMIMEType, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSC::Structure* structure = zigGlobalObject->m_JSMIMETypeClassStructure.get(zigGlobalObject);

    JSC::JSValue newTarget = callFrame->newTarget();
    if (zigGlobalObject->m_JSMIMETypeClassStructure.constructor(zigGlobalObject) != newTarget) [[unlikely]] {
        if (!newTarget) {
            throwTypeError(globalObject, scope, "Class constructor MIMEType cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = JSC::InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(), functionGlobalObject->m_JSMIMETypeClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    // 1. Get input string
    JSValue inputArg = callFrame->argument(0);
    auto* jsInputString = inputArg.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto inputString = jsInputString->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // 2. Parse type and subtype
    String type, subtype;
    size_t paramsStartIndex;
    std::tie(type, subtype, paramsStartIndex) = parseTypeAndSubtype(globalObject, inputString);
    RETURN_IF_EXCEPTION(scope, {}); // Check if parseTypeAndSubtype threw

    // 3. Create and parse parameters
    // We need the structure for JSMIMEParams to create the map and the instance
    JSC::Structure* paramsStructure = zigGlobalObject->m_JSMIMEParamsClassStructure.get(zigGlobalObject);
    JSMap* paramsMap = JSMap::create(vm, globalObject->mapStructure());
    RETURN_IF_EXCEPTION(scope, {}); // OOM check for map

    auto paramsStringView = inputString->substring(paramsStartIndex);
    parseMIMEParamsString(globalObject, paramsMap, paramsStringView);
    RETURN_IF_EXCEPTION(scope, {});

    JSMIMEParams* paramsInstance = JSMIMEParams::create(vm, paramsStructure, paramsMap);

    // 4. Create the JSMIMEType instance
    JSMIMEType* instance = JSMIMEType::create(vm, structure, WTF::move(type), WTF::move(subtype), paramsInstance);

    return JSC::JSValue::encode(instance);
}

void JSMIMETypeConstructor::finishCreation(VM& vm, JSObject* prototype)
{
    Base::finishCreation(vm, 1, "MIMEType"_s); // Constructor length is 1
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
}

//-- Structure Setup --

void setupJSMIMETypeClassStructure(LazyClassStructure::Initializer& init)
{
    VM& vm = init.vm;
    JSGlobalObject* globalObject = init.global;

    // Create Prototype
    auto* prototypeStructure = JSMIMETypePrototype::createStructure(vm, globalObject, globalObject->objectPrototype());
    auto* prototype = JSMIMETypePrototype::create(vm, globalObject, prototypeStructure);

    // Create Constructor
    auto* constructorStructure = JSMIMETypeConstructor::createStructure(vm, globalObject, globalObject->functionPrototype());
    auto* constructor = JSMIMETypeConstructor::create(vm, constructorStructure, prototype);

    // Create Instance Structure
    auto* instanceStructure = JSMIMEType::createStructure(vm, globalObject, prototype);

    init.setPrototype(prototype);
    init.setStructure(instanceStructure);
    init.setConstructor(constructor);
}

} // namespace WebCore
