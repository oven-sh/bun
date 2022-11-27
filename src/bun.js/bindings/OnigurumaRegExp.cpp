#include "OnigurumaRegExp.h"

#include "ZigGlobalObject.h"
#define ONIG_ESCAPE_UCHAR_COLLISION
#include "oniguruma/src/oniguruma.h"

using namespace JSC;
using namespace WebCore;

#include "WebCoreJSClientData.h"

extern "C" EncodedJSValue jsFunctionGetOnigurumaRegExpConstructor(JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName)
{
    auto& vm = lexicalGlobalObject->vm();
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSValue::encode(globalObject->OnigurumaRegExpConstructor());
}

namespace Zig {

static WTF::String to16Bit(ASCIILiteral str)
{
    UChar* buffer = nullptr;
    auto out = WTF::StringImpl::createUninitialized(str.length(), buffer);
    WTF::StringImpl::copyCharacters(buffer, str.characters8(), str.length());
    return WTF::String(WTFMove(out));
}

static WTF::String to16Bit(JSC::JSString* str, JSC::JSGlobalObject* globalObject)
{
    if (!str->is8Bit() || str->length() == 0) {
        return str->value(globalObject);
    }

    auto value = str->value(globalObject);
    auto outStr = WTF::String(value.characters8(), value.length());
    outStr.convertTo16Bit();
    return outStr;
}

static WTF::String to16Bit(WTF::String str)
{
    if (str.is8Bit()) {
        auto out = str.isolatedCopy();
        out.convertTo16Bit();
        return out;
    }

    return str;
}

static WTF::String to16Bit(JSValue jsValue, JSC::JSGlobalObject* globalObject, ASCIILiteral defaultValue)
{
    if (!jsValue || jsValue.isUndefinedOrNull()) {
        return to16Bit(defaultValue);
    }

    auto* jsString = jsValue.toString(globalObject);
    if (jsString->length() == 0) {
        return to16Bit(defaultValue);
    }

    return to16Bit(jsString, globalObject);
}

static WTF::String convertToOnigurumaSyntax(const WTF::String& string)
{
    WTF::StringBuilder sb;
    uint32_t length = string.length();
    const UChar* characters = string.characters16();
    bool inCharacterClass = false;
    bool inCharacterProperty = false;

    for (int i = 0; i < length; i++) {

        // extend multibyte hex characters
        while (characters[i] == '\\') {
            if (i + 1 < length && characters[i + 1] == 'x') {
                if (i + 2 < length && isxdigit(characters[i + 2])) {
                    if (i + 3 < length && isxdigit(characters[i + 3])) {
                        sb.append(string.substring(i, 4));
                        sb.append("\\x00"_s);
                        i += 4;
                    } else {
                        // skip '\'
                        sb.append(string.substring(i + 1, 2));
                        i += 3;
                    }
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        if (i >= length) {
            break;
        }

        // convert character properties
        if (UNLIKELY(characters[i] == '{' && i - 2 >= 0 && (characters[i - 1] == 'p' || characters[i - 1] == 'P') && characters[i - 2] == '\\')) {
            sb.append(characters[i]);
            i += 1;
            if (i == length) {
                break;
            }

            // handle negative
            if (characters[i] == '^') {
                sb.append(characters[i]);
                i += 1;
                if (i == length) {
                    break;
                }
            }

            // could be \p{propName=propValue} or \p{propValue}.
            bool foundEquals = false;
            WTF::StringBuilder propName;
            while (characters[i] != '}') {
                if (characters[i] == '=') {
                    foundEquals = true;
                    i += 1;
                    if (i == length) {
                        break;
                    }
                    continue;
                }

                if (foundEquals) {
                    sb.append(characters[i]);
                } else {
                    propName.append(characters[i]);
                }

                i += 1;
                if (i == length) {
                    break;
                }
            }

            if (!foundEquals) {
                sb.append(propName.toString());
            }
        }

        if (i >= length) {
            break;
        }

        // escape brackets in character classes
        if (inCharacterClass) {
            // we know ']' will be escaped so there isn't a need to scan for the closing bracket
            if (characters[i] == '[' || characters[i] == ']') {
                if (characters[i - 1] != '\\') {
                    // character class intersections not supported, assume end of character class
                    if (characters[i] == ']') {
                        inCharacterClass = false;
                    } else {
                        sb.append('\\');
                    }
                }
            }
        } else {
            if (characters[i] == '[') {
                if (i - 1 >= 0) {
                    if (characters[i - 1] != '\\') {
                        inCharacterClass = true;
                    }
                } else {
                    inCharacterClass = true;
                }
            }
        }

        sb.append(characters[i]);
    }

    return to16Bit(sb.toString());
}

static inline bool is16BitLineTerminator(UChar c)
{
    return c == '\r' || c == '\n' || (c & ~1) == 0x2028;
}

static inline WTF::String escapedPattern(const WTF::String& pattern, const UChar* characters, size_t length)
{
    bool previousCharacterWasBackslash = false;
    bool inBrackets = false;
    bool shouldEscape = false;

    // 15.10.6.4 specifies that RegExp.prototype.toString must return '/' + source + '/',
    // and also states that the result must be a valid RegularExpressionLiteral. '//' is
    // not a valid RegularExpressionLiteral (since it is a single line comment), and hence
    // source cannot ever validly be "". If the source is empty, return a different Pattern
    // that would match the same thing.
    if (!length)
        return "(?:)"_s;

    // early return for strings that don't contain a forwards slash and LineTerminator
    for (unsigned i = 0; i < length; ++i) {
        UChar ch = characters[i];
        if (!previousCharacterWasBackslash) {
            if (inBrackets) {
                if (ch == ']')
                    inBrackets = false;
            } else {
                if (ch == '/') {
                    shouldEscape = true;
                    break;
                }
                if (ch == '[')
                    inBrackets = true;
            }
        }

        if (is16BitLineTerminator(ch)) {
            shouldEscape = true;
            break;
        }

        if (previousCharacterWasBackslash)
            previousCharacterWasBackslash = false;
        else
            previousCharacterWasBackslash = ch == '\\';
    }

    if (!shouldEscape)
        return pattern;

    previousCharacterWasBackslash = false;
    inBrackets = false;
    StringBuilder result;
    for (unsigned i = 0; i < length; ++i) {
        UChar ch = characters[i];
        if (!previousCharacterWasBackslash) {
            if (inBrackets) {
                if (ch == ']')
                    inBrackets = false;
            } else {
                if (ch == '/')
                    result.append('\\');
                else if (ch == '[')
                    inBrackets = true;
            }
        }

        // escape LineTerminator
        if (is16BitLineTerminator(ch)) {
            if (!previousCharacterWasBackslash) {
                result.append('\\');
            }

            if (ch == '\n') {
                result.append('n');
            } else if (ch == '\r') {
                result.append('r');
            } else if (ch == 0x2028) {
                result.append("u2028");
            } else {
                result.append("u2029");
            }
        } else
            result.append(ch);

        if (previousCharacterWasBackslash)
            previousCharacterWasBackslash = false;
        else
            previousCharacterWasBackslash = ch == '\\';
    }

    return result.toString();
}

WTF::String sortRegExpFlags(WTF::String flagsString)
{
    WTF::Vector<UChar> flags = { 'd', 'g', 'i', 'm', 's', 'u', 'y' };
    WTF::StringBuilder result;

    for (auto flag : flags) {
        if (flagsString.contains(flag)) {
            result.append(flag);
        }
    }

    return result.toString();
}

bool validateRegExpFlags(WTF::StringView flags)
{
    std::map<char16_t, bool> flagsAllowed = { { 'g', false }, { 'i', false }, { 'm', false }, { 's', false }, { 'u', false }, { 'y', false }, { 'd', false } };
    for (auto flag : flags.codeUnits()) {
        auto flagItr = flagsAllowed.find(flag);
        if (flagItr == flagsAllowed.end() || flagItr->second) {
            return false;
        }
        flagItr->second = true;
    }

    return true;
}

std::once_flag onigurumaEncodingInitFlag;

static regex_t* createOnigurumaRegExp(JSGlobalObject* globalObject, const WTF::String& patternString, const WTF::String& flagsString, int& errorCode, OnigErrorInfo& errorInfo)
{
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    OnigEncoding encodings[] = {
        ONIG_ENCODING_UTF16_LE,
    };
    std::call_once(onigurumaEncodingInitFlag, [&encodings]() {
        onig_initialize(encodings, 1);
    });

    OnigOptionType options = 0;
    if (flagsString.contains('i')) {
        options |= ONIG_OPTION_IGNORECASE;
    }
    if (flagsString.contains('m')) {
        options |= ONIG_OPTION_MULTILINE;
    } else {
        options |= ONIG_OPTION_SINGLELINE;
    }
    if (flagsString.contains('s')) {
        options |= ONIG_OPTION_MULTILINE;
    }

    OnigSyntaxType* syntax = ONIG_SYNTAX_ONIGURUMA;
    OnigEncodingType* encoding = encodings[0];
    regex_t* onigRegExp = NULL;

    errorCode = onig_new(
        &onigRegExp,
        reinterpret_cast<const OnigUChar*>(patternString.characters16()),
        reinterpret_cast<const OnigUChar*>(patternString.characters16() + patternString.length()),
        options,
        encoding,
        syntax,
        &errorInfo);

    return onigRegExp;
}

class OnigurumaRegExpPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static OnigurumaRegExpPrototype* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        OnigurumaRegExpPrototype* ptr = new (NotNull, JSC::allocateCell<OnigurumaRegExpPrototype>(vm)) OnigurumaRegExpPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    OnigurumaRegExpPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

const ClassInfo OnigurumaRegExpConstructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(OnigurumaRegExpConstructor) };
const ClassInfo OnigurumaRegExpPrototype::s_info = { "Object"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(OnigurumaRegExpPrototype) };
const ClassInfo OnigurumaRegEx::s_info = { "RegExp"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(OnigurumaRegEx) };

JSC_DEFINE_CUSTOM_GETTER(onigurumaRegExpProtoGetterGlobal, (JSGlobalObject * globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto* thisValue = jsDynamicCast<OnigurumaRegEx*>(JSValue::decode(encodedThis));
    if (UNLIKELY(!thisValue)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(jsBoolean(thisValue->flagsString().contains('g')));
}

JSC_DEFINE_CUSTOM_GETTER(onigurumaRegExpProtoGetterDotAll, (JSGlobalObject * globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto* thisValue = jsDynamicCast<OnigurumaRegEx*>(JSValue::decode(encodedThis));
    if (UNLIKELY(!thisValue)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(jsBoolean(thisValue->flagsString().contains('s')));
}

JSC_DEFINE_CUSTOM_GETTER(onigurumaRegExpProtoGetterHasIndices, (JSGlobalObject * globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto* thisValue = jsDynamicCast<OnigurumaRegEx*>(JSValue::decode(encodedThis));
    if (UNLIKELY(!thisValue)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(jsBoolean(thisValue->flagsString().contains('d')));
}

JSC_DEFINE_CUSTOM_GETTER(onigurumaRegExpProtoGetterIgnoreCase, (JSGlobalObject * globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto* thisValue = jsDynamicCast<OnigurumaRegEx*>(JSValue::decode(encodedThis));
    if (UNLIKELY(!thisValue)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(jsBoolean(thisValue->flagsString().contains('i')));
}

JSC_DEFINE_CUSTOM_GETTER(onigurumaRegExpProtoGetterMultiline, (JSGlobalObject * globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto* thisValue = jsDynamicCast<OnigurumaRegEx*>(JSValue::decode(encodedThis));
    if (UNLIKELY(!thisValue)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(jsBoolean(thisValue->flagsString().contains('m')));
}

JSC_DEFINE_CUSTOM_GETTER(onigurumaRegExpProtoGetterSticky, (JSGlobalObject * globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto* thisValue = jsDynamicCast<OnigurumaRegEx*>(JSValue::decode(encodedThis));
    if (UNLIKELY(!thisValue)) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsBoolean(thisValue->flagsString().contains('y')));
}

JSC_DEFINE_CUSTOM_GETTER(onigurumaRegExpProtoGetterUnicode, (JSGlobalObject * globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto* thisValue = jsDynamicCast<OnigurumaRegEx*>(JSValue::decode(encodedThis));
    if (UNLIKELY(!thisValue)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(jsBoolean(thisValue->flagsString().contains('u')));
}

JSC_DEFINE_CUSTOM_GETTER(onigurumaRegExpProtoGetterSource, (JSGlobalObject * globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto* thisValue = jsDynamicCast<OnigurumaRegEx*>(JSValue::decode(encodedThis));
    if (!thisValue)
        return JSValue::encode(jsUndefined());

    return JSValue::encode(jsString(globalObject->vm(), escapedPattern(thisValue->patternString(), thisValue->patternString().characters16(), thisValue->patternString().length())));
}

JSC_DEFINE_CUSTOM_GETTER(onigurumaRegExpProtoGetterFlags, (JSGlobalObject * globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto* thisValue = jsDynamicCast<OnigurumaRegEx*>(JSValue::decode(encodedThis));
    if (!thisValue)
        return JSValue::encode(jsUndefined());

    return JSValue::encode(jsString(globalObject->vm(), thisValue->flagsString()));
}

JSC_DEFINE_CUSTOM_GETTER(onigurumaRegExpProtoGetterLastIndex, (JSGlobalObject * globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto* thisValue = jsDynamicCast<OnigurumaRegEx*>(JSValue::decode(encodedThis));
    if (UNLIKELY(!thisValue)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(jsNumber(thisValue->m_lastIndex));
}

JSC_DEFINE_CUSTOM_SETTER(onigurumaRegExpProtoSetterLastIndex, (JSGlobalObject * globalObject, EncodedJSValue encodedThis, EncodedJSValue encodedValue, PropertyName))
{
    auto* thisValue = jsDynamicCast<OnigurumaRegEx*>(JSValue::decode(encodedThis));
    if (UNLIKELY(!thisValue)) {
        return JSValue::encode(jsUndefined());
    }
    auto throwScope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSValue value = JSValue::decode(encodedValue);
    if (!value.isAnyInt()) {
        throwException(globalObject, throwScope, createTypeError(globalObject, "lastIndex must be an integer"_s));
        return false;
    }
    int32_t lastIndex = value.toInt32(globalObject);
    thisValue->m_lastIndex = lastIndex;
    return true;
}

// compile is deprecated
JSC_DEFINE_HOST_FUNCTION(onigurumaRegExpProtoFuncCompile, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_CATCH_SCOPE(vm);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    auto* thisRegExp = jsDynamicCast<OnigurumaRegEx*>(callFrame->thisValue());
    if (UNLIKELY(!thisRegExp))
        return JSValue::encode(jsUndefined());

    if (thisRegExp->globalObject() != globalObject) {
        throwScope.throwException(globalObject, createTypeError(globalObject, makeString("RegExp.prototype.compile function's Realm must be the same to |this| RegExp object"_s)));
        return JSValue::encode({});
    }

    JSValue arg0 = callFrame->argument(0);
    JSValue arg1 = callFrame->argument(1);

    WTF::String patternStringExtended;
    if (auto* regExpObject = jsDynamicCast<OnigurumaRegEx*>(arg0)) {
        if (!arg1.isUndefined()) {
            throwScope.throwException(globalObject, createTypeError(globalObject, makeString("Cannot supply flags when constructing one RegExp from another."_s)));
            return JSValue::encode({});
        }
        thisRegExp->setPatternString(regExpObject->patternString());
        patternStringExtended = convertToOnigurumaSyntax(thisRegExp->patternString());
        thisRegExp->setFlagsString(regExpObject->flagsString());
    } else {
        WTF::String newPatternString = to16Bit(arg0, globalObject, "(?:)"_s);
        RETURN_IF_EXCEPTION(scope, {});

        patternStringExtended = convertToOnigurumaSyntax(newPatternString);

        WTF::String newFlagsString = to16Bit(arg1, globalObject, ""_s);
        RETURN_IF_EXCEPTION(scope, {});

        if (!validateRegExpFlags(newFlagsString)) {
            throwScope.throwException(globalObject, createSyntaxError(globalObject, makeString("Invalid flags supplied to RegExp constructor."_s)));
            return JSValue::encode({});
        }

        newFlagsString = sortRegExpFlags(newFlagsString);

        thisRegExp->setPatternString(newPatternString);
        thisRegExp->setFlagsString(newFlagsString);
    }

    // for pattern syntax checking
    int errorCode = 0;
    OnigErrorInfo errorInfo = { 0 };
    regex_t* onigurumaRegExp = createOnigurumaRegExp(globalObject, convertToOnigurumaSyntax(thisRegExp->patternString()), thisRegExp->flagsString(), errorCode, errorInfo);
    if (errorCode != ONIG_NORMAL) {
        OnigUChar errorBuff[ONIG_MAX_ERROR_MESSAGE_LEN] = { 0 };
        int length = onig_error_code_to_str(errorBuff, errorCode, &errorInfo);
        WTF::StringBuilder errorMessage;
        errorMessage.append("Invalid regular expression: "_s);
        if (length < 0) {
            errorMessage.append("An unknown error occurred."_s);
        } else {
            errorMessage.appendCharacters(errorBuff, length);
        }
        if (onigurumaRegExp != nullptr) {
            onig_free(onigurumaRegExp);
        }
        throwScope.throwException(globalObject, createSyntaxError(globalObject, errorMessage.toString()));
        return JSValue::encode({});
    }
    onig_free(onigurumaRegExp);

    thisRegExp->m_lastIndex = 0;

    return JSValue::encode(thisRegExp);
}

JSC_DEFINE_HOST_FUNCTION(onigurumaRegExpProtoFuncTest, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto* thisValue = jsDynamicCast<OnigurumaRegEx*>(callFrame->thisValue());
    if (!thisValue)
        return JSValue::encode(jsUndefined());

    JSValue arg = callFrame->argument(0);
    if (!arg.isString()) {
        scope.throwException(globalObject, createTypeError(globalObject, "Argument 0 of RegExp.prototype.test must be a string"_s));
        return JSValue::encode(jsBoolean(false));
    }

    WTF::String string = to16Bit(arg, globalObject, ""_s);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    int errorCode = 0;
    OnigErrorInfo errorInfo = { 0 };
    regex_t* onigurumaRegExp = createOnigurumaRegExp(globalObject, convertToOnigurumaSyntax(thisValue->patternString()), thisValue->flagsString(), errorCode, errorInfo);
    if (errorCode != ONIG_NORMAL) {
        OnigUChar errorBuff[ONIG_MAX_ERROR_MESSAGE_LEN] = { 0 };
        int length = onig_error_code_to_str(errorBuff, errorCode, &errorInfo);
        WTF::StringBuilder errorMessage;
        errorMessage.append("Invalid regular expression: "_s);
        if (length < 0) {
            errorMessage.append("An unknown error occurred."_s);
        } else {
            errorMessage.appendCharacters(errorBuff, length);
        }
        if (onigurumaRegExp != nullptr) {
            onig_free(onigurumaRegExp);
        }
        throwScope.throwException(globalObject, createSyntaxError(globalObject, errorMessage.toString()));
        return JSValue::encode({});
    }

    OnigRegion* region = onig_region_new();

    const OnigUChar* end = reinterpret_cast<const OnigUChar*>(string.characters16() + string.length());
    const OnigUChar* start = reinterpret_cast<const OnigUChar*>(string.characters16() + thisValue->m_lastIndex);
    const OnigUChar* range = end;

    if (thisValue->m_lastIndex >= string.length()) {
        onig_region_free(region, 1);
        onig_free(onigurumaRegExp);
        thisValue->m_lastIndex = 0;
        return JSValue::encode(jsBoolean(false));
    }

    int result = onig_search(
        onigurumaRegExp,
        reinterpret_cast<const OnigUChar*>(string.characters16()),
        end,
        start,
        range,
        region,
        ONIG_OPTION_DEFAULT);

    if (result < 0) {
        thisValue->m_lastIndex = 0;
        onig_region_free(region, 1);
        onig_free(onigurumaRegExp);
        return JSValue::encode(jsBoolean(false));
    }

    if (thisValue->flagsString().contains('y') && region->beg[0] != thisValue->m_lastIndex) {
        onig_region_free(region, 1);
        onig_free(onigurumaRegExp);
        return JSValue::encode(jsBoolean(false));
    }

    if (thisValue->flagsString().contains('g')) {
        thisValue->m_lastIndex = region->end[0] / 2;
    } else {
        thisValue->m_lastIndex = 0;
    }

    onig_region_free(region, 1);
    onig_free(onigurumaRegExp);

    return JSValue::encode(jsBoolean(true));
}

JSC_DEFINE_HOST_FUNCTION(onigurumaRegExpProtoFuncExec, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto* thisValue = jsDynamicCast<OnigurumaRegEx*>(callFrame->thisValue());
    if (!thisValue)
        return JSValue::encode(jsUndefined());

    JSValue arg = callFrame->argument(0);
    if (!arg || arg.isUndefinedOrNull()) {
        thisValue->m_lastIndex = 0;
        return JSValue::encode(jsNull());
    }

    WTF::String string = to16Bit(arg, globalObject, ""_s);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    int errorCode = 0;
    OnigErrorInfo errorInfo = { 0 };
    regex_t* onigurumaRegExp = createOnigurumaRegExp(globalObject, convertToOnigurumaSyntax(thisValue->patternString()), thisValue->flagsString(), errorCode, errorInfo);
    if (errorCode != ONIG_NORMAL) {
        OnigUChar errorBuff[ONIG_MAX_ERROR_MESSAGE_LEN] = { 0 };
        int length = onig_error_code_to_str(errorBuff, errorCode, &errorInfo);
        WTF::StringBuilder errorMessage;
        errorMessage.append("Invalid regular expression: "_s);
        if (length < 0) {
            errorMessage.append("An unknown error occurred."_s);
        } else {
            errorMessage.appendCharacters(errorBuff, length);
        }
        if (onigurumaRegExp != nullptr) {
            onig_free(onigurumaRegExp);
        }
        throwScope.throwException(globalObject, createSyntaxError(globalObject, errorMessage.toString()));
        return JSValue::encode({});
    }

    OnigRegion* region = onig_region_new();

    const OnigUChar* end = reinterpret_cast<const OnigUChar*>(string.characters16() + string.length());
    const OnigUChar* start = reinterpret_cast<const OnigUChar*>(string.characters16() + thisValue->m_lastIndex);
    const OnigUChar* range = end;

    int result = onig_search(
        onigurumaRegExp,
        reinterpret_cast<const OnigUChar*>(string.characters16()),
        end,
        start,
        range,
        region,
        ONIG_OPTION_DEFAULT);

    if (result < 0) {
        onig_region_free(region, 1);
        onig_free(onigurumaRegExp);
        thisValue->m_lastIndex = 0;
        return JSValue::encode(jsNull());
    }

    JSArray* array = constructEmptyArray(globalObject, nullptr, 0);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    JSArray* indicesArray = constructEmptyArray(globalObject, nullptr, 0);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    array->putDirect(vm, vm.propertyNames->index, jsNumber(region->beg[0] / 2));
    array->putDirect(vm, vm.propertyNames->input, jsString(vm, string));
    array->putDirect(vm, vm.propertyNames->groups, jsUndefined());

    for (int i = 0; i < region->num_regs; i++) {
        size_t outStringLen = (region->end[i] / 2) - (region->beg[i] / 2);
        UChar* ptr;
        WTF::String outString;
        if (outStringLen > 0) {
            outString = WTF::String::createUninitialized(static_cast<unsigned int>(outStringLen), ptr);
            if (UNLIKELY(!ptr)) {
                throwOutOfMemoryError(globalObject, scope);
                onig_region_free(region, 1);
                onig_free(onigurumaRegExp);
                return JSValue::encode(jsNull());
            }

            memcpy(ptr, (region->beg[i] / 2) + string.characters16(), outStringLen * sizeof(UChar));
        }

        array->putDirectIndex(globalObject, i, jsString(vm, outString));

        JSArray* indices = constructEmptyArray(globalObject, nullptr, 0);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        indices->putDirectIndex(globalObject, 0, jsNumber(region->beg[i] / 2));
        indices->putDirectIndex(globalObject, 1, jsNumber(region->end[i] / 2));
        indicesArray->putDirectIndex(globalObject, i, indices);
    }

    if (thisValue->flagsString().contains('d')) {
        array->putDirect(vm, vm.propertyNames->indices, indicesArray);
    }

    if (thisValue->flagsString().contains('g')) {
        thisValue->m_lastIndex = region->end[0] / 2;
    } else {
        thisValue->m_lastIndex = 0;
    }

    onig_region_free(region, 1);
    onig_free(onigurumaRegExp);

    return JSValue::encode(array);
}

JSC_DEFINE_HOST_FUNCTION(onigurumaRegExpProtoFuncToString, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisValue = jsDynamicCast<OnigurumaRegEx*>(callFrame->thisValue());
    if (!thisValue)
        return JSValue::encode(jsUndefined());

    WTF::String patternString = escapedPattern(thisValue->patternString(), thisValue->patternString().characters16(), thisValue->patternString().length());
    WTF::String flagsString = thisValue->flagsString();

    WTF::StringBuilder source;
    source.append("/"_s);
    source.append(patternString);
    source.append("/"_s);
    source.append(flagsString);

    return JSValue::encode(jsString(globalObject->vm(), source.toString()));
}

void OnigurumaRegExpPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    this->putDirectNativeFunction(vm, globalObject, PropertyName(vm.propertyNames->compile), 2, onigurumaRegExpProtoFuncCompile, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(0));
    this->putDirectNativeFunction(vm, globalObject, PropertyName(vm.propertyNames->exec), 1, onigurumaRegExpProtoFuncExec, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(0));
    this->putDirectNativeFunction(vm, globalObject, PropertyName(vm.propertyNames->toString), 0, onigurumaRegExpProtoFuncToString, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(0));
    this->putDirectCustomAccessor(vm, vm.propertyNames->global, JSC::CustomGetterSetter::create(vm, onigurumaRegExpProtoGetterGlobal, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->dotAll, JSC::CustomGetterSetter::create(vm, onigurumaRegExpProtoGetterDotAll, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->hasIndices, JSC::CustomGetterSetter::create(vm, onigurumaRegExpProtoGetterHasIndices, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->ignoreCase, JSC::CustomGetterSetter::create(vm, onigurumaRegExpProtoGetterIgnoreCase, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->multiline, JSC::CustomGetterSetter::create(vm, onigurumaRegExpProtoGetterMultiline, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->sticky, JSC::CustomGetterSetter::create(vm, onigurumaRegExpProtoGetterSticky, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->unicode, JSC::CustomGetterSetter::create(vm, onigurumaRegExpProtoGetterUnicode, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->source, JSC::CustomGetterSetter::create(vm, onigurumaRegExpProtoGetterSource, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->flags, JSC::CustomGetterSetter::create(vm, onigurumaRegExpProtoGetterFlags, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->lastIndex, JSC::CustomGetterSetter::create(vm, onigurumaRegExpProtoGetterLastIndex, onigurumaRegExpProtoSetterLastIndex), 0 | PropertyAttribute::CustomAccessor);

    this->putDirectNativeFunction(vm, globalObject, PropertyName(vm.propertyNames->test), 1, onigurumaRegExpProtoFuncTest, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(0));

    this->putDirectBuiltinFunction(vm, globalObject, vm.propertyNames->matchSymbol, onigurumaRegExpPrototypeMatchCodeGenerator(vm), static_cast<unsigned>(0));
    this->putDirectBuiltinFunction(vm, globalObject, vm.propertyNames->matchAllSymbol, onigurumaRegExpPrototypeMatchAllCodeGenerator(vm), static_cast<unsigned>(0));
    this->putDirectBuiltinFunction(vm, globalObject, vm.propertyNames->replaceSymbol, onigurumaRegExpPrototypeReplaceCodeGenerator(vm), static_cast<unsigned>(0));
    this->putDirectBuiltinFunction(vm, globalObject, vm.propertyNames->searchSymbol, onigurumaRegExpPrototypeSearchCodeGenerator(vm), static_cast<unsigned>(0));
    this->putDirectBuiltinFunction(vm, globalObject, vm.propertyNames->splitSymbol, onigurumaRegExpPrototypeSplitCodeGenerator(vm), static_cast<unsigned>(0));
}

JSC::Structure* OnigurumaRegExpConstructor::createClassStructure(JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    JSC::VM& vm = globalObject->vm();
    return OnigurumaRegEx::createStructure(
        vm,
        globalObject,
        prototype);
}
JSC::JSObject* OnigurumaRegExpConstructor::createPrototype(JSC::JSGlobalObject* globalObject)
{
    return OnigurumaRegExpPrototype::create(globalObject->vm(), globalObject, OnigurumaRegExpPrototype::createStructure(globalObject->vm(), globalObject, globalObject->objectPrototype()));
}

void OnigurumaRegExpConstructor::finishCreation(VM& vm, JSValue prototype)
{

    Base::finishCreation(vm, 0, "RegExp"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

OnigurumaRegExpConstructor* OnigurumaRegExpConstructor::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSValue prototype)
{
    OnigurumaRegExpConstructor* ptr = new (NotNull, JSC::allocateCell<OnigurumaRegExpConstructor>(vm)) OnigurumaRegExpConstructor(vm, structure, construct);
    ptr->finishCreation(vm, prototype);
    return ptr;
}

static JSC::EncodedJSValue constructOrCall(Zig::GlobalObject* globalObject, JSValue arg0, JSValue arg1)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_CATCH_SCOPE(vm);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    WTF::String patternString = to16Bit(arg0, globalObject, "(?:)"_s);
    RETURN_IF_EXCEPTION(scope, {});

    WTF::String flagsString = to16Bit(arg1, globalObject, ""_s);
    RETURN_IF_EXCEPTION(scope, {});

    if (!validateRegExpFlags(flagsString)) {
        throwScope.throwException(globalObject, createSyntaxError(globalObject, makeString("Invalid flags supplied to RegExp constructor."_s)));
        return JSValue::encode({});
    }

    flagsString = sortRegExpFlags(flagsString);

    // create for pattern compilation errors, but need to create another for each exec/test
    int errorCode = 0;
    OnigErrorInfo errorInfo = { 0 };
    regex_t* onigurumaRegExp = createOnigurumaRegExp(globalObject, convertToOnigurumaSyntax(patternString), flagsString, errorCode, errorInfo);
    if (errorCode != ONIG_NORMAL) {
        OnigUChar errorBuff[ONIG_MAX_ERROR_MESSAGE_LEN] = { 0 };
        int length = onig_error_code_to_str(errorBuff, errorCode, &errorInfo);
        WTF::StringBuilder errorMessage;
        errorMessage.append("Invalid regular expression: "_s);
        if (length < 0) {
            errorMessage.append("An unknown error occurred."_s);
        } else {
            errorMessage.appendCharacters(errorBuff, length);
        }
        throwScope.throwException(globalObject, createSyntaxError(globalObject, errorMessage.toString()));
        return JSValue::encode({});
    }
    onig_free(onigurumaRegExp);

    OnigurumaRegEx* result = OnigurumaRegEx::create(globalObject, WTFMove(patternString), WTFMove(flagsString));

    return JSValue::encode(result);
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES OnigurumaRegExpConstructor::construct(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    JSC::VM& vm = globalObject->vm();
    JSObject* newTarget = asObject(callFrame->newTarget());
    auto* constructor = globalObject->OnigurumaRegExpConstructor();
    Structure* structure = globalObject->OnigurumaRegExpStructure();
    if (constructor != newTarget) {
        auto scope = DECLARE_THROW_SCOPE(vm);

        auto* functionGlobalObject = reinterpret_cast<Zig::GlobalObject*>(
            // ShadowRealm functions belong to a different global object.
            getFunctionRealm(globalObject, newTarget));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(
            globalObject,
            newTarget,
            functionGlobalObject->OnigurumaRegExpStructure());
    }

    return constructOrCall(globalObject, callFrame->argument(0), callFrame->argument(1));
}

}
