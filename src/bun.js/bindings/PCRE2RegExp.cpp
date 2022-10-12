#include "PCRE2RegExp.h"

#include "ZigGlobalObject.h"
#define PCRE2_CODE_UNIT_WIDTH 16
#include "pcre2.h"

using namespace JSC;
using namespace WebCore;


extern "C" EncodedJSValue jsFunctionGetPCRE2RegExpConstructor(JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName)
{
    auto& vm = lexicalGlobalObject->vm();
    Zig::GlobalObject *globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSValue::encode(globalObject->PCRE2RegExpConstructor());
}

namespace Zig {





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
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    // static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

    const WTF::String& flagsString() const { return m_flagsString; }
    void setFlagsString(const WTF::String& flagsString) { m_flagsString = flagsString; }
    const WTF::String& patternString() const { return m_patternString; }
    void setPatternString(const WTF::String& patternString) { m_patternString = patternString; }

    pcre2_code_16* m_regExpCode = NULL;

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
    thisValue->globalObject() == globalObject;
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

    // check thisValue->patternString() for slashes and return escaped string

    return JSValue::encode(jsString(globalObject->vm(), thisValue->patternString()));
}

JSC_DEFINE_CUSTOM_GETTER(pcre2RegExpProtoGetterFlags, (JSGlobalObject *globalObject, EncodedJSValue encodedThis, PropertyName))
{
    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(JSValue::decode(encodedThis));
    if (!thisValue)
        return JSValue::encode(jsUndefined());

    return JSValue::encode(jsString(globalObject->vm(), thisValue->flagsString()));
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
        return JSValue::encode(throwScope.throwException(globalObject, createTypeError(globalObject, makeString("RegExp.prototype.compile function's Realm must be the same to |this| RegExp object"_s))));
    }

    JSValue arg0 = callFrame->argument(0);
    JSValue arg1 = callFrame->argument(1);

    if (auto* regExpObject = jsDynamicCast<PCRE2RegExp*>(arg0)) {
        if (!arg1.isUndefined()) {
            return JSValue::encode(throwScope.throwException(globalObject, createTypeError(globalObject, makeString("Cannot supply flags when constructing one RegExp from another."_s))));
        }
        thisRegExp->setPatternString(regExpObject->patternString());
        thisRegExp->setFlagsString(regExpObject->flagsString());
    } else {
        WTF::String newPatternString = arg0.isUndefined() ? WTF::String("(?:)"_s) : arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        WTF::String newFlagsString = arg1.isUndefined() ? emptyString() : arg1.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        if (!validateRegExpFlags(newFlagsString)) {
            return JSValue::encode(throwScope.throwException(globalObject, createSyntaxError(globalObject, makeString("Invalid flags supplied to RegExp constructor"_s))));
        }

        thisRegExp->setPatternString(newPatternString);
        thisRegExp->setFlagsString(newFlagsString);
    }

    uint32_t flags = 0;
    if (thisRegExp->flagsString().contains("i"_s)) {
        flags |= PCRE2_CASELESS;
    }
    if (thisRegExp->flagsString().contains("m"_s)) {
        flags |= PCRE2_MULTILINE;
    }
    if (thisRegExp->flagsString().contains("s"_s)) {
        flags |= PCRE2_DOTALL;
    }
    if (thisRegExp->flagsString().contains("u"_s)) {
        flags |= PCRE2_UTF;
    }
    if (thisRegExp->flagsString().contains("y"_s)) {
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
        return JSValue::encode(throwScope.throwException(globalObject, createSyntaxError(globalObject, errorMessage.toString())));
    }

    thisRegExp->m_regExpCode = regExpCode;

    // if(newFlagsString.is8Bit()) {
    //     newFlagsString.make16BitFrom8BitSource(newFlagsString.characters8(), newFlagsString.length());
    // }

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

    WTF::String string = arg.toString(globalObject)->value(globalObject);

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

    if (matchResult < 0) {
        // catch more errors here?

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

    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(pcre2RegExpProtoFuncToString, (JSGlobalObject *globalObject ,JSC::CallFrame *callFrame))
{
    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(callFrame->thisValue());
    if (!thisValue)
        return JSValue::encode(jsUndefined());

    WTF::String patternString = thisValue->patternString();
    WTF::String flagsString = thisValue->flagsString();


    return JSValue::encode(jsString(globalObject->vm(), WTF::String("/"_s + patternString + "/"_s + flagsString)));
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
    this->putDirectNativeFunction(vm, globalObject, PropertyName(vm.propertyNames->test),  1, pcre2RegExpProtoFuncTest, ImplementationVisibility::Public,  NoIntrinsic, static_cast<unsigned>(0));

    // JSC_BUILTIN_FUNCTION_WITHOUT_TRANSITION(vm.propertyNames->matchSymbol, pcre2RegExpPrototypeMatchCodeGenerator, static_cast<unsigned>(0));
    // JSC_BUILTIN_FUNCTION_WITHOUT_TRANSITION(vm.propertyNames->matchAllSymbol, pcre2RegExpPrototypeMatchAllCodeGenerator, static_cast<unsigned>(0));
    // JSC_BUILTIN_FUNCTION_WITHOUT_TRANSITION(vm.propertyNames->replaceSymbol, pcre2RegExpPrototypeReplaceCodeGenerator, static_cast<unsigned>(0));
    // JSC_BUILTIN_FUNCTION_WITHOUT_TRANSITION(vm.propertyNames->searchSymbol, pcre2RegExpPrototypeSearchCodeGenerator, static_cast<unsigned>(0));
    // JSC_BUILTIN_FUNCTION_WITHOUT_TRANSITION(vm.propertyNames->splitSymbol, pcre2RegExpPrototypeSplitCodeGenerator, static_cast<unsigned>(0));
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

    auto scope = DECLARE_CATCH_SCOPE(vm);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    WTF::String patternString = WTF::String("(?:)"_s);
    if (auto *patternStr = callFrame->argument(0).toStringOrNull(globalObject)) {
        patternString = patternStr->value(globalObject);
    }
    RETURN_IF_EXCEPTION(scope, {});

    WTF::String flagsString = WTF::String();
    if (callFrame->argumentCount() > 1) {
        if (auto *flagsStr = callFrame->argument(1).toStringOrNull(globalObject)) {
            flagsString = flagsStr->value(globalObject);
        }
    }
    RETURN_IF_EXCEPTION(scope, {});

    if(!validateRegExpFlags(flagsString)) {
        return JSValue::encode(throwScope.throwException(globalObject, createSyntaxError(globalObject, makeString("Invalid flags supplied to RegExp constructor"_s))));
    }

    // pcre2_general_context_16* context = pcre2_general_context_create_16(nullptr, nullptr, nullptr);
    // pcre2_compile_context_16* compileContext = pcre2_compile_context_create_16(NULL);

    uint32_t flags = 0;
    if (flagsString.contains("i"_s)) {
        flags |= PCRE2_CASELESS;
    }
    if (flagsString.contains("m"_s)) {
        flags |= PCRE2_MULTILINE;
    }
    if (flagsString.contains("s"_s)) {
        flags |= PCRE2_DOTALL;
    }
    if (flagsString.contains("u"_s)) {
        flags |= PCRE2_UTF;
    }
    if (flagsString.contains(makeString("y"_s))) {
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
        return JSValue::encode(throwScope.throwException(globalObject, createSyntaxError(globalObject, errorMessage.toString())));
    }

    RETURN_IF_EXCEPTION(scope, {});

    PCRE2RegExp *result = PCRE2RegExp::create(globalObject, WTFMove(patternString), WTFMove(flagsString), regExpCode);

    return JSValue::encode(result);
}

}

void compileRegExp(PCRE2RegExp& obj, int& errorCode, PCRE2_SIZE& errorOffset) {
    //     pcre2_code_free_16(obj.m_regExpCode);

//     errorCode = 0;
//     errorOffset = 0;
//     pcre2_code_16* regExpCode = pcre2_compile_16(
//         reinterpret_cast<const PCRE2_SPTR16>(obj.patternString().characters16()),
//         obj.patternString().length(),
//         0,
//         &errorCode,
//         &errorOffset,
//         NULL
//     );

//     obj.m_regExpCode = regExpCode;


//     if (NULL == regExpCode) {
//         PCRE2_UCHAR16 errorBuffer[256] = { 0 };
//         pcre2_get_error_message_16(errorCode, errorBuffer, sizeof(errorBuffer));
//         auto message = WTF::String(WTF::StringImpl::createWithoutCopying(reinterpret_cast<UChar*>(errorBuffer), sizeof(errorBuffer) / sizeof(UChar)));
// auto throwScope =  DECLARE_THROW_SCOPE(vm);

//         throwSyntaxError(globalObject, throwScope, makeString("Invalid regular expression", message, "\n\t"_s, obj.patternString()));
//         return;
//     }
}