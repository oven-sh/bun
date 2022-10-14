#include "PCRE2RegExp.h"

#include "ZigGlobalObject.h"
#define PCRE2_CODE_UNIT_WIDTH 16
#include "pcre2.h"

using namespace JSC;
using namespace WebCore;

#include "WebCoreJSClientData.h"

extern "C" EncodedJSValue jsFunctionGetPCRE2RegExpConstructor(JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName)
{
    auto& vm = lexicalGlobalObject->vm();
    Zig::GlobalObject *globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSValue::encode(globalObject->PCRE2RegExpConstructor());
}

namespace Zig {

static WTF::String to16Bit(ASCIILiteral str)
{
    return WTF::String::make16BitFrom8BitSource(str.characters8(), str.length());
}

static  WTF::String to16Bit(JSC::JSString* str, JSC::JSGlobalObject *globalObject) {
    if (!str->is8Bit() || str->length() == 0) {
        return str->value(globalObject);
    }

    auto value = str->value(globalObject);
    return WTF::String::make16BitFrom8BitSource(value.characters8(), value.length());
}


static  WTF::String to16Bit(JSValue jsValue, JSC::JSGlobalObject *globalObject, ASCIILiteral defaultValue) {
    if (!jsValue || jsValue.isUndefinedOrNull()) {
        return  to16Bit(defaultValue);
    }

    auto *jsString = jsValue.toString(globalObject);
    if (jsString->length() == 0) {
        return to16Bit(defaultValue);
    }

    return to16Bit(jsString, globalObject);
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
            }
            else if (ch == '\r') {
                result.append('r');
            }
            else if (ch == 0x2028) {
                result.append("u2028");
            }
            else {
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

WTF::String sortRegExpFlags(WTF::String flagsString) {
    WTF::Vector<UChar> flags = {'d', 'g', 'i', 'm', 's', 'u', 'y'};
    WTF::StringBuilder result;

    for (auto flag : flags) {
        if (flagsString.contains(flag)) {
            result.append(flag);
        }
    }

    return result.toString();
}

bool validateRegExpFlags(WTF::StringView flags){
    std::map<char16_t, bool> flagsAllowed = {{'g', false}, {'i', false}, {'m', false}, {'s', false}, {'u', false}, {'y', false}, {'d', false}};
    for (auto flag : flags.codeUnits()) {
        auto flagItr = flagsAllowed.find(flag);
        if (flagItr == flagsAllowed.end() || flagItr->second) {
            return false;
        }
        flagItr->second = true;
    }

    return true;
}

class PCRE2RegExpPrototype final : public JSC::JSNonFinalObject {
    public:
        using Base = JSC::JSNonFinalObject;
    
        static PCRE2RegExpPrototype* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
        {
            PCRE2RegExpPrototype* ptr = new (NotNull, JSC::allocateCell<PCRE2RegExpPrototype>(vm)) PCRE2RegExpPrototype(vm, globalObject, structure);
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
        PCRE2RegExpPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
            : Base(vm, structure)
        {
        }
    
        void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
    };
    


class PCRE2RegExp final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static PCRE2RegExp* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        PCRE2RegExp* ptr = new (NotNull, JSC::allocateCell<PCRE2RegExp>(vm)) PCRE2RegExp(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    static PCRE2RegExp* create(JSC::JSGlobalObject* globalObject, WTF::String&& pattern, WTF::String&& flags, pcre2_code_16* regExpCode) {
        auto *structure = reinterpret_cast<Zig::GlobalObject*>(globalObject)->PCRE2RegExpStructure();
        auto *object = create(globalObject->vm(), globalObject, structure);
        object->m_flagsString = WTFMove(flags);
        object->m_patternString = WTFMove(pattern);
        object->m_regExpCode = regExpCode;

        return object;
    }


    DECLARE_EXPORT_INFO;                                                                                                                                                    
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)                                                                
    {                                                                                                                                                                       
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)                                                                                                            
            return nullptr;                                                                                                                                                 
 
        return WebCore::subspaceForImpl<PCRE2RegExp, UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForPCRE2RegExp.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForPCRE2RegExp = WTFMove(space); },
            [](auto& spaces) { return spaces.m_subspaceForPCRE2RegExp.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForPCRE2RegExp = WTFMove(space); });
                                                                                
    }                                                                                                                                                                       
        

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(RegExpObjectType, StructureFlags), info());
    }

    // static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

    const WTF::String& flagsString() const { return m_flagsString; }
    void setFlagsString(const WTF::String& flagsString) { m_flagsString = flagsString; }
    const WTF::String& patternString() const { return m_patternString; }
    void setPatternString(const WTF::String& patternString) { m_patternString = patternString; }

    pcre2_code_16* m_regExpCode = NULL;
    int32_t m_lastIndex = 0;

private:
    PCRE2RegExp(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&) {
        Base::finishCreation(vm());

    }

    WTF::String m_patternString = {};
    WTF::String m_flagsString = {};

};

const ClassInfo PCRE2RegExpConstructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(PCRE2RegExpConstructor) };
const ClassInfo PCRE2RegExpPrototype::s_info = { "Object"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(PCRE2RegExpPrototype) };
const ClassInfo PCRE2RegExp::s_info = { "RegExp"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(PCRE2RegExp) };

JSC_DEFINE_CUSTOM_GETTER(pcre2RegExpProtoGetterGlobal, (JSGlobalObject *globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(JSValue::decode(encodedThis));
    if (UNLIKELY(!thisValue)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(jsBoolean(thisValue->flagsString().contains('g') ? true : false));
}

JSC_DEFINE_CUSTOM_GETTER(pcre2RegExpProtoGetterDotAll, (JSGlobalObject *globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(JSValue::decode(encodedThis));
    if (UNLIKELY(!thisValue)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(jsBoolean(thisValue->flagsString().contains('s') ? true : false));
}

JSC_DEFINE_CUSTOM_GETTER(pcre2RegExpProtoGetterHasIndices, (JSGlobalObject *globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(JSValue::decode(encodedThis));
    if (UNLIKELY(!thisValue)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(jsBoolean(thisValue->flagsString().contains('d') ? true : false));
}

JSC_DEFINE_CUSTOM_GETTER(pcre2RegExpProtoGetterIgnoreCase, (JSGlobalObject *globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(JSValue::decode(encodedThis));
    if (UNLIKELY(!thisValue)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(jsBoolean(thisValue->flagsString().contains('i') ? true : false));
}

JSC_DEFINE_CUSTOM_GETTER(pcre2RegExpProtoGetterMultiline, (JSGlobalObject *globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(JSValue::decode(encodedThis));
    if (UNLIKELY(!thisValue)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(jsBoolean(thisValue->flagsString().contains('m') ? true : false));
}

JSC_DEFINE_CUSTOM_GETTER(pcre2RegExpProtoGetterSticky, (JSGlobalObject *globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(JSValue::decode(encodedThis));
    if (UNLIKELY(!thisValue)) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsBoolean(thisValue->flagsString().contains('y') ? true : false));
}

JSC_DEFINE_CUSTOM_GETTER(pcre2RegExpProtoGetterUnicode, (JSGlobalObject *globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(JSValue::decode(encodedThis));
    if (UNLIKELY(!thisValue)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(jsBoolean(thisValue->flagsString().contains('u') ? true : false));
}

JSC_DEFINE_CUSTOM_GETTER(pcre2RegExpProtoGetterSource, (JSGlobalObject *globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(JSValue::decode(encodedThis));
    if (!thisValue)
        return JSValue::encode(jsUndefined());

    return JSValue::encode(jsString(globalObject->vm(), escapedPattern(thisValue->patternString(), thisValue->patternString().characters16(), thisValue->patternString().length())));
}

JSC_DEFINE_CUSTOM_GETTER(pcre2RegExpProtoGetterFlags, (JSGlobalObject *globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(JSValue::decode(encodedThis));
    if (!thisValue)
        return JSValue::encode(jsUndefined());

    return JSValue::encode(jsString(globalObject->vm(), thisValue->flagsString()));
}

JSC_DEFINE_CUSTOM_GETTER(pcre2RegExpProtoGetterLastIndex, (JSGlobalObject *globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(JSValue::decode(encodedThis));
    return JSValue::encode(jsNumber(thisValue->m_lastIndex));
}

JSC_DEFINE_CUSTOM_SETTER(pcre2RegExpProtoSetterLastIndex, (JSGlobalObject *globalObject, EncodedJSValue encodedThis, EncodedJSValue encodedValue, PropertyName))
{
    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(JSValue::decode(encodedThis));
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
JSC_DEFINE_HOST_FUNCTION(pcre2RegExpProtoFuncCompile, (JSGlobalObject *globalObject, JSC::CallFrame *callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_CATCH_SCOPE(vm);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    auto *thisRegExp = jsDynamicCast<PCRE2RegExp*>(callFrame->thisValue());
    if (UNLIKELY(!thisRegExp))
        return JSValue::encode(jsUndefined());

    if (thisRegExp->globalObject() != globalObject) {
        throwScope.throwException(globalObject, createTypeError(globalObject, makeString("RegExp.prototype.compile function's Realm must be the same to |this| RegExp object"_s)));
        return JSValue::encode({});
    }

    JSValue arg0 = callFrame->argument(0);
    JSValue arg1 = callFrame->argument(1);

    if (auto* regExpObject = jsDynamicCast<PCRE2RegExp*>(arg0)) {
        if (!arg1.isUndefined()) {
            throwScope.throwException(globalObject, createTypeError(globalObject, makeString("Cannot supply flags when constructing one RegExp from another."_s)));
            return JSValue::encode({});
        }
        thisRegExp->setPatternString(regExpObject->patternString());
        thisRegExp->setFlagsString(regExpObject->flagsString());
    } else {
        WTF::String newPatternString = to16Bit(arg0, globalObject, "(?:)"_s);
        RETURN_IF_EXCEPTION(scope, {});

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

    uint32_t flags = 0;
    if (thisRegExp->flagsString().contains('i')) {
        flags |= PCRE2_CASELESS;
    }
    if (thisRegExp->flagsString().contains('m')) {
        flags |= PCRE2_MULTILINE;
    }
    if (thisRegExp->flagsString().contains('s')) {
        flags |= PCRE2_DOTALL;
    }
    if (thisRegExp->flagsString().contains('u')) {
        flags |= PCRE2_UTF;
    }
    if (thisRegExp->flagsString().contains('y')) {
        flags |= PCRE2_ANCHORED;
    }

    int errorCode = 0;
    PCRE2_SIZE errorOffset = 0;
    pcre2_code_16* regExpCode = pcre2_compile_16(
        reinterpret_cast<const PCRE2_SPTR16>(thisRegExp->patternString().characters16()),
        thisRegExp->patternString().length(),
        flags,
        &errorCode,
        &errorOffset,
        NULL
    );

    if (regExpCode == NULL) {
        PCRE2_UCHAR16 buffer[256] = { 0 };
        pcre2_get_error_message_16(errorCode, buffer, sizeof(buffer));

        WTF::StringBuilder errorMessage = WTF::StringBuilder();
        errorMessage.append("Invalid regular expression: ");
        errorMessage.append(reinterpret_cast<const char16_t*>(buffer));
        errorMessage.append(" at offset: ");
        errorMessage.append(errorOffset);
        throwScope.throwException(globalObject, createSyntaxError(globalObject, errorMessage.toString()));
        return JSValue::encode({});
    }

    pcre2_code_free_16(thisRegExp->m_regExpCode);
    thisRegExp->m_regExpCode = regExpCode;

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(pcre2RegExpProtoFuncTest, (JSGlobalObject *globalObject, JSC::CallFrame *callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(callFrame->thisValue());
    if (!thisValue)
        return JSValue::encode(jsUndefined());

    JSValue arg = callFrame->argument(0);
    if (!arg.isString()) {
        scope.throwException(globalObject, createTypeError(globalObject, "Argument 0 of RegExp.prototype.test must be a string"_s));
        return JSValue::encode(jsBoolean(false));
    }

    WTF::String string = to16Bit(arg, globalObject, ""_s);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    pcre2_match_data_16* matchData = pcre2_match_data_create_from_pattern_16(thisValue->m_regExpCode, NULL);

    int matchResult = pcre2_match_16(
        thisValue->m_regExpCode,
        reinterpret_cast<PCRE2_SPTR16>(string.characters16()),
        string.length(),
        0,
        0,
        matchData,
        NULL
    );

    pcre2_match_data_free_16(matchData);

    if (matchResult < 0) {
        // catch errors here?

        // switch(matchResult) {
        //     case PCRE2_ERROR_NOMATCH: {
        //         return JSValue::encode(jsBoolean(false));
        //     }
        //     default: {
        //         return JSValue::encode(jsBoolean(false));
        //     }
        // }
        return JSValue::encode(jsBoolean(false));
    }


    return JSValue::encode(jsBoolean(true));
}
JSC_DEFINE_HOST_FUNCTION(pcre2RegExpProtoFuncExec, (JSGlobalObject *globalObject ,JSC::CallFrame *callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(callFrame->thisValue());
    if (!thisValue)
        return JSValue::encode(jsUndefined());

    JSValue arg = callFrame->argument(0);
    if (!arg || arg.isUndefinedOrNull()) {
        thisValue->m_lastIndex = 0;
        return JSValue::encode(jsNull());
    }

    WTF::String string = to16Bit(arg, globalObject, ""_s);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    pcre2_match_data_16* matchData = pcre2_match_data_create_from_pattern_16(thisValue->m_regExpCode, NULL);

    int matchResult = pcre2_match_16(
        thisValue->m_regExpCode,
        reinterpret_cast<PCRE2_SPTR16>(string.characters16()),
        string.length(),
        thisValue->m_lastIndex,
        0,
        matchData,
        NULL
    );

    if (matchResult < 0) {
        // catch errors here?

        // switch(matchResult) {
        //     case PCRE2_ERROR_NOMATCH: {
        //         return JSValue::encode(jsBoolean(false));
        //     }
        //     default: {
        //         return JSValue::encode(jsBoolean(false));
        //     }
        // }
        return JSValue::encode(jsNull());
    }

    size_t* outVector = pcre2_get_ovector_pointer_16(matchData);

    if (matchResult == 0) {
        // no matches
        pcre2_match_data_free_16(matchData);
        return JSValue::encode(jsNull());
    }

    PCRE2_SPTR16 str = reinterpret_cast<PCRE2_SPTR16>(string.characters16());

    size_t count = pcre2_get_ovector_count_16(matchData);

    JSArray* indicesArray = constructEmptyArray(globalObject, nullptr, 0);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    JSArray* result = constructEmptyArray(globalObject, nullptr, 0);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    
    result->putDirect(vm, vm.propertyNames->index, jsNumber(outVector[0]));
    result->putDirect(vm, vm.propertyNames->input, jsString(vm, string));
    result->putDirect(vm, vm.propertyNames->groups, jsUndefined());

    for (size_t i = 0; i < count; i++) {
        PCRE2_SPTR16 substringStart = str + outVector[2 * i];
        PCRE2_SIZE substringLength = outVector[2 * i + 1] - outVector[2 * i];
        UChar *ptr;
        WTF::String outString;
        
        if (substringLength > 0) {
            outString = WTF::String::createUninitialized(static_cast<unsigned int>(substringLength), ptr); 
            if (UNLIKELY(!ptr)) {
                throwOutOfMemoryError(globalObject, scope);
                pcre2_match_data_free_16(matchData);
                return JSValue::encode(jsNull());
            }
        
            memcpy(ptr, substringStart, substringLength * sizeof(UChar));;
        }

        result->putDirectIndex(globalObject, i, jsString(vm, outString));

        JSArray* indices = constructEmptyArray(globalObject, nullptr, 2);
        indices->putDirectIndex(globalObject, 0, jsNumber(outVector[2 * i]));
        indices->putDirectIndex(globalObject, 1, jsNumber(outVector[2 * i + 1]));
        indicesArray->putDirectIndex(globalObject, i, indices);

        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    }

    if (thisValue->flagsString().contains('g')) {
        result->putDirect(vm, vm.propertyNames->indices, indicesArray);
    }

    thisValue->m_lastIndex = outVector[2 * (count - 1) + 1];

    pcre2_match_data_free_16(matchData);

    return JSValue::encode(result);
}
JSC_DEFINE_HOST_FUNCTION(pcre2RegExpProtoFuncToString, (JSGlobalObject *globalObject ,JSC::CallFrame *callFrame))
{
    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(callFrame->thisValue());
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

void PCRE2RegExpPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    this->putDirectNativeFunction(vm, globalObject, PropertyName(vm.propertyNames->compile),  2,  pcre2RegExpProtoFuncCompile, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(0));
    this->putDirectNativeFunction(vm, globalObject, PropertyName(vm.propertyNames->exec),  1,  pcre2RegExpProtoFuncExec, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(0));
    this->putDirectNativeFunction(vm, globalObject, PropertyName(vm.propertyNames->toString),  0,  pcre2RegExpProtoFuncToString, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(0));
    this->putDirectCustomAccessor(vm, vm.propertyNames->global,  JSC::CustomGetterSetter::create(vm, pcre2RegExpProtoGetterGlobal, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->dotAll,  JSC::CustomGetterSetter::create(vm, pcre2RegExpProtoGetterDotAll, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->hasIndices,  JSC::CustomGetterSetter::create(vm, pcre2RegExpProtoGetterHasIndices, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->ignoreCase,  JSC::CustomGetterSetter::create(vm, pcre2RegExpProtoGetterIgnoreCase, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->multiline,  JSC::CustomGetterSetter::create(vm, pcre2RegExpProtoGetterMultiline, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->sticky,  JSC::CustomGetterSetter::create(vm, pcre2RegExpProtoGetterSticky, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->unicode,  JSC::CustomGetterSetter::create(vm, pcre2RegExpProtoGetterUnicode, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->source,  JSC::CustomGetterSetter::create(vm, pcre2RegExpProtoGetterSource, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->flags,  JSC::CustomGetterSetter::create(vm, pcre2RegExpProtoGetterFlags, nullptr), 0 | PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly);
    this->putDirectCustomAccessor(vm, vm.propertyNames->lastIndex, JSC::CustomGetterSetter::create(vm, pcre2RegExpProtoGetterLastIndex, pcre2RegExpProtoSetterLastIndex), 0 | PropertyAttribute::CustomAccessor);;
    this->putDirectNativeFunction(vm, globalObject, PropertyName(vm.propertyNames->test),  1, pcre2RegExpProtoFuncTest, ImplementationVisibility::Public,  NoIntrinsic, static_cast<unsigned>(0));

    this->putDirectBuiltinFunction(vm, globalObject, vm.propertyNames->matchSymbol, pCRE2RegExpPrototypeMatchCodeGenerator(vm), static_cast<unsigned>(0));
    this->putDirectBuiltinFunction(vm, globalObject, vm.propertyNames->matchAllSymbol, pCRE2RegExpPrototypeMatchAllCodeGenerator(vm), static_cast<unsigned>(0));
    this->putDirectBuiltinFunction(vm, globalObject, vm.propertyNames->replaceSymbol, pCRE2RegExpPrototypeReplaceCodeGenerator(vm), static_cast<unsigned>(0));
    this->putDirectBuiltinFunction(vm, globalObject, vm.propertyNames->searchSymbol, pCRE2RegExpPrototypeSearchCodeGenerator(vm), static_cast<unsigned>(0));
    this->putDirectBuiltinFunction(vm, globalObject, vm.propertyNames->splitSymbol, pCRE2RegExpPrototypeSplitCodeGenerator(vm), static_cast<unsigned>(0));
}

JSC::Structure* PCRE2RegExpConstructor::createClassStructure(JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    JSC::VM& vm = globalObject->vm();
    return PCRE2RegExp::createStructure(
        vm,
        globalObject,
        prototype
    );
}
JSC::JSObject* PCRE2RegExpConstructor::createPrototype(JSC::JSGlobalObject* globalObject)
{
    return PCRE2RegExpPrototype::create(globalObject->vm(), globalObject, PCRE2RegExpPrototype::createStructure(globalObject->vm(), globalObject, globalObject->objectPrototype()));
}
    

void PCRE2RegExpConstructor::finishCreation(VM &vm, JSValue prototype)
{

    Base::finishCreation(vm, 0, "RegExp"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

PCRE2RegExpConstructor* PCRE2RegExpConstructor::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSValue prototype) 
{
    PCRE2RegExpConstructor* ptr = new (NotNull, JSC::allocateCell<PCRE2RegExpConstructor>(vm)) PCRE2RegExpConstructor(vm, structure, construct);
    ptr->finishCreation(vm, prototype);
    return ptr;
}

static JSC::EncodedJSValue constructOrCall(Zig::GlobalObject *globalObject, JSValue arg0, JSValue arg1)
{
    auto &vm = globalObject->vm();
    auto scope = DECLARE_CATCH_SCOPE(vm);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    WTF::String patternString = to16Bit(arg0, globalObject, "(?:)"_s);
    RETURN_IF_EXCEPTION(scope, {});

    WTF::String flagsString = to16Bit(arg1, globalObject, ""_s);
    RETURN_IF_EXCEPTION(scope, {});

    if(!validateRegExpFlags(flagsString)) {
        throwScope.throwException(globalObject, createSyntaxError(globalObject, makeString("Invalid flags supplied to RegExp constructor."_s)));
        return JSValue::encode({});
    }

    flagsString = sortRegExpFlags(flagsString);

    uint32_t flags = 0;
    if (flagsString.contains('i')) {
        flags |= PCRE2_CASELESS;
    }
    if (flagsString.contains('m')) {
        flags |= PCRE2_MULTILINE;
    }
    if (flagsString.contains('s')) {
        flags |= PCRE2_DOTALL;
    }
    if (flagsString.contains('u')) {
        flags |= PCRE2_UTF;
    }
    if (flagsString.contains('y')) {
        flags |= PCRE2_ANCHORED;
    }

    int errorCode = 0;
    PCRE2_SIZE errorOffset = 0;
    pcre2_code_16* regExpCode = pcre2_compile_16(
        reinterpret_cast<const PCRE2_SPTR16>(patternString.characters16()),
        patternString.length(),
        flags,
        &errorCode,
        &errorOffset,
        NULL
    );

    if (regExpCode == NULL) {
        PCRE2_UCHAR16 buffer[256] = { 0 };
        pcre2_get_error_message_16(errorCode, buffer, sizeof(buffer));

        WTF::StringBuilder errorMessage = WTF::StringBuilder();
        errorMessage.append("Invalid regular expression: ");
        errorMessage.append(reinterpret_cast<const char16_t*>(buffer));
        errorMessage.append(" at offset: ");
        errorMessage.append(errorOffset);
        throwScope.throwException(globalObject, createSyntaxError(globalObject, errorMessage.toString()));
        return JSValue::encode({});
    }

    RETURN_IF_EXCEPTION(scope, {});

    PCRE2RegExp *result = PCRE2RegExp::create(globalObject, WTFMove(patternString), WTFMove(flagsString), regExpCode);

    return JSValue::encode(result);
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES PCRE2RegExpConstructor::construct(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    Zig::GlobalObject *globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    JSC::VM &vm = globalObject->vm();
    JSObject* newTarget = asObject(callFrame->newTarget());
    auto* constructor = globalObject->PCRE2RegExpConstructor();
    Structure* structure = globalObject->PCRE2RegExpStructure();
    if (constructor != newTarget) {
      auto scope = DECLARE_THROW_SCOPE(vm);

      auto* functionGlobalObject = reinterpret_cast<Zig::GlobalObject*>(
        // ShadowRealm functions belong to a different global object.
        getFunctionRealm(globalObject, newTarget)
      );
      RETURN_IF_EXCEPTION(scope, {});
      structure = InternalFunction::createSubclassStructure(
        globalObject,
        newTarget,
        functionGlobalObject->PCRE2RegExpStructure()
      );
    }

    return constructOrCall(globalObject, callFrame->argument(0), callFrame->argument(1));
}

}
