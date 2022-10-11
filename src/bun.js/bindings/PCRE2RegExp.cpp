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

    static PCRE2RegExp* create(JSC::JSGlobalObject* globalObject, WTF::String&& pattern, WTF::String&& flags) {
        auto *structure = reinterpret_cast<Zig::GlobalObject*>(globalObject)->PCRE2RegExpStructure();
        auto *object = create(globalObject->vm(), globalObject, structure);
        object->m_flagsString = WTFMove(flags);
        object->m_sourceString = WTFMove(pattern);
        


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
    const WTF::String& sourceString() const { return m_sourceString; }
private:
    PCRE2RegExp(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&) {
        Base::finishCreation(vm());

    }

    WTF::String m_sourceString = {};
    WTF::String m_flagsString = {};

};

const ClassInfo PCRE2RegExpConstructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(PCRE2RegExpConstructor) };
const ClassInfo PCRE2RegExpPrototype::s_info = { "Object"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(PCRE2RegExpPrototype) };
const ClassInfo PCRE2RegExp::s_info = { "RegExp"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(PCRE2RegExp) };

JSC_DEFINE_HOST_FUNCTION(pcre2RegExpProtoGetterGlobal, (JSGlobalObject *globalObject, JSC::CallFrame *callFrame))
{
    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(pcre2RegExpProtoGetterDotAll, (JSGlobalObject *globalObject, JSC::CallFrame *callFrame))
{
    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(pcre2RegExpProtoGetterHasIndices, (JSGlobalObject *globalObject, JSC::CallFrame *callFrame))
{
    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(pcre2RegExpProtoGetterIgnoreCase, (JSGlobalObject *globalObject, JSC::CallFrame *callFrame))
{
    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(pcre2RegExpProtoGetterMultiline, (JSGlobalObject *globalObject, JSC::CallFrame *callFrame))
{
    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(pcre2RegExpProtoGetterSticky, (JSGlobalObject *globalObject, JSC::CallFrame *callFrame))
{
    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(pcre2RegExpProtoGetterUnicode, (JSGlobalObject *globalObject, JSC::CallFrame *callFrame))
{
    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(pcre2RegExpProtoGetterSource, (JSGlobalObject *globalObject, JSC::CallFrame *callFrame))
{
    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(callFrame->thisValue());
    if (!thisValue)
        return JSValue::encode(jsUndefined());

    return JSValue::encode(jsString(globalObject->vm(), thisValue->sourceString()));
}
JSC_DEFINE_HOST_FUNCTION(pcre2RegExpProtoGetterFlags, (JSGlobalObject *globalObject, JSC::CallFrame *callFrame))
{
    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(callFrame->thisValue());
    if (!thisValue)
        return JSValue::encode(jsUndefined());

    return JSValue::encode(jsString(globalObject->vm(), thisValue->flagsString()));
}

JSC_DEFINE_HOST_FUNCTION(pcre2RegExpProtoFuncCompile, (JSGlobalObject *globalObject ,JSC::CallFrame *callFrame))
{

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(pcre2RegExpProtoFuncTest, (JSGlobalObject *globalObject ,JSC::CallFrame *callFrame))
{
    auto *thisValue = jsDynamicCast<PCRE2RegExp*>(callFrame->thisValue());
    if (!thisValue)
        return JSValue::encode(jsUndefined());


    
    

    return JSValue::encode(jsBoolean(false));
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

    return JSValue::encode(jsString(globalObject->vm(), thisValue->sourceString()));
}



void PCRE2RegExpPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    this->putDirectNativeFunction(vm, globalObject, PropertyName(vm.propertyNames->compile),  2,  pcre2RegExpProtoFuncCompile, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(PropertyAttribute::DontEnum));
    this->putDirectNativeFunction(vm, globalObject, PropertyName(vm.propertyNames->exec),  1,  pcre2RegExpProtoFuncExec, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(PropertyAttribute::DontEnum));
    this->putDirectNativeFunction(vm, globalObject, PropertyName(vm.propertyNames->toString),  0,  pcre2RegExpProtoFuncToString, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(PropertyAttribute::DontEnum));
    this->putDirect(vm,  vm.propertyNames->global, JSC::JSFunction::create(vm, globalObject, 0, WTF::String("global"_s), pcre2RegExpProtoGetterGlobal, ImplementationVisibility::Public), PropertyAttribute::DontEnum | PropertyAttribute::Accessor);
    this->putDirect(vm,  vm.propertyNames->dotAll, JSC::JSFunction::create(vm, globalObject, 0, WTF::String("dotAll"_s), pcre2RegExpProtoGetterDotAll, ImplementationVisibility::Public), PropertyAttribute::DontEnum | PropertyAttribute::Accessor);
    this->putDirect(vm,  vm.propertyNames->hasIndices, JSC::JSFunction::create(vm, globalObject, 0, WTF::String("hasIndices"_s), pcre2RegExpProtoGetterHasIndices, ImplementationVisibility::Public), PropertyAttribute::DontEnum | PropertyAttribute::Accessor);
    this->putDirect(vm,  vm.propertyNames->ignoreCase, JSC::JSFunction::create(vm, globalObject, 0, WTF::String("ignoreCase"_s), pcre2RegExpProtoGetterIgnoreCase, ImplementationVisibility::Public), PropertyAttribute::DontEnum | PropertyAttribute::Accessor);
    this->putDirect(vm,  vm.propertyNames->multiline, JSC::JSFunction::create(vm, globalObject, 0, WTF::String("multiline"_s), pcre2RegExpProtoGetterMultiline, ImplementationVisibility::Public), PropertyAttribute::DontEnum | PropertyAttribute::Accessor);
    this->putDirect(vm,  vm.propertyNames->sticky, JSC::JSFunction::create(vm, globalObject, 0, WTF::String("sticky"_s), pcre2RegExpProtoGetterSticky, ImplementationVisibility::Public), PropertyAttribute::DontEnum | PropertyAttribute::Accessor);
    this->putDirect(vm,  vm.propertyNames->unicode, JSC::JSFunction::create(vm, globalObject, 0, WTF::String("unicode"_s), pcre2RegExpProtoGetterUnicode, ImplementationVisibility::Public), PropertyAttribute::DontEnum | PropertyAttribute::Accessor);
    this->putDirect(vm,  vm.propertyNames->source, JSC::JSFunction::create(vm, globalObject, 0, WTF::String("source"_s), pcre2RegExpProtoGetterSource, ImplementationVisibility::Public), PropertyAttribute::DontEnum | PropertyAttribute::Accessor);
    this->putDirect(vm,  vm.propertyNames->flags, JSC::JSFunction::create(vm, globalObject, 0, WTF::String("flags"_s), pcre2RegExpProtoGetterFlags, ImplementationVisibility::Public), PropertyAttribute::DontEnum | PropertyAttribute::Accessor);
    this->putDirectNativeFunction(vm, globalObject, PropertyName(vm.propertyNames->test),  1, pcre2RegExpProtoFuncTest, ImplementationVisibility::Public,  NoIntrinsic, static_cast<unsigned>(PropertyAttribute::DontEnum));

    // JSC_BUILTIN_FUNCTION_WITHOUT_TRANSITION(vm.propertyNames->matchSymbol, pcre2RegExpPrototypeMatchCodeGenerator, static_cast<unsigned>(PropertyAttribute::DontEnum));
    // JSC_BUILTIN_FUNCTION_WITHOUT_TRANSITION(vm.propertyNames->matchAllSymbol, pcre2RegExpPrototypeMatchAllCodeGenerator, static_cast<unsigned>(PropertyAttribute::DontEnum));
    // JSC_BUILTIN_FUNCTION_WITHOUT_TRANSITION(vm.propertyNames->replaceSymbol, pcre2RegExpPrototypeReplaceCodeGenerator, static_cast<unsigned>(PropertyAttribute::DontEnum));
    // JSC_BUILTIN_FUNCTION_WITHOUT_TRANSITION(vm.propertyNames->searchSymbol, pcre2RegExpPrototypeSearchCodeGenerator, static_cast<unsigned>(PropertyAttribute::DontEnum));
    // JSC_BUILTIN_FUNCTION_WITHOUT_TRANSITION(vm.propertyNames->splitSymbol, pcre2RegExpPrototypeSplitCodeGenerator, static_cast<unsigned>(PropertyAttribute::DontEnum));
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
    // business logic here
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

    // validate the regexp, throwing an error on failure

    PCRE2RegExp *result = PCRE2RegExp::create(globalObject, WTFMove(patternString), WTFMove(flagsString));
    
    return JSValue::encode(result);
}

}