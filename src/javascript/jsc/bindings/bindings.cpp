
#include "headers.h"
#include "root.h"



#include <JavaScriptCore/ExceptionScope.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/text/WTFString.h>
#include <wtf/text/StringImpl.h>
#include <wtf/text/ExternalStringImpl.h>
#include <wtf/text/StringView.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/WasmFaultSignalHandler.h>
#include <wtf/text/StringCommon.h>

template<class To, class From>
To cast(From v)
{
    return *static_cast<To*>(static_cast<void*>(v));
}

template<class To, class From>
To ccast(From v)
{
    return *static_cast<const To*>(static_cast<const void*>(v));
}

extern "C"  {

#pragma mark - JSC::JSValue

JSC__JSCell* JSC__JSValue__asCell(JSC__JSValue JSValue0) {
    auto value = JSC::JSValue::decode(JSValue0);
    return value.asCell();
}
double JSC__JSValue__asNumber(JSC__JSValue JSValue0) {
    auto value = JSC::JSValue::decode(JSValue0);
    return value.asNumber();
};
bJSC__JSObject JSC__JSValue__asObject(JSC__JSValue JSValue0) {
    auto value = JSC::JSValue::decode(JSValue0);
    auto obj = JSC::asObject(value);
    return cast<bJSC__JSObject>(&obj);
};
JSC__JSString* JSC__JSValue__asString(JSC__JSValue JSValue0) {
    auto value = JSC::JSValue::decode(JSValue0);
    return JSC::asString(value);
};
// uint64_t JSC__JSValue__encode(JSC__JSValue JSValue0) {

// }
bool JSC__JSValue__eqlCell(JSC__JSValue JSValue0, JSC__JSCell* arg1) {
    return JSC::JSValue::decode(JSValue0) == arg1;
};
bool JSC__JSValue__eqlValue(JSC__JSValue JSValue0, JSC__JSValue JSValue1) {
    return JSC::JSValue::decode(JSValue0) == JSC::JSValue::decode(JSValue1);
};
JSC__JSValue JSC__JSValue__getPrototype(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1) { 
    auto value = JSC::JSValue::decode(JSValue0);
    return JSC::JSValue::encode(value.getPrototype(arg1));   
}
bool JSC__JSValue__isAnyInt(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isAnyInt();  }
bool JSC__JSValue__isBigInt(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isBigInt();  }
bool JSC__JSValue__isBigInt32(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isBigInt32();  }
bool JSC__JSValue__isBoolean(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isBoolean();  }
bool JSC__JSValue__isCell(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isCell();  }
bool JSC__JSValue__isCustomGetterSetter(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isCustomGetterSetter();  }
// bool JSC__JSValue__isError(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).getPrototype()  }
bool JSC__JSValue__isGetterSetter(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isGetterSetter();  }
bool JSC__JSValue__isHeapBigInt(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isHeapBigInt();  }
bool JSC__JSValue__isInt32AsAnyInt(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isInt32AsAnyInt();  }
bool JSC__JSValue__isNull(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isNull();  }
bool JSC__JSValue__isNumber(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isNumber();  }
bool JSC__JSValue__isObject(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isObject();  }
bool JSC__JSValue__isPrimitive(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isPrimitive();  }
bool JSC__JSValue__isString(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isString();  }
bool JSC__JSValue__isSymbol(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isSymbol();  }
bool JSC__JSValue__isUInt32AsAnyInt(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isUInt32AsAnyInt();  }
bool JSC__JSValue__isUndefined(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isUndefined();  }
bool JSC__JSValue__isUndefinedOrNull(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isUndefinedOrNull();  }
JSC__JSValue JSC__JSValue__jsBoolean(bool arg0) { return JSC::JSValue::encode(JSC::jsBoolean(arg0)); };
JSC__JSValue JSC__JSValue__jsDoubleNumber(double arg0) {return JSC::JSValue::encode(JSC::jsNumber(arg0)); }
JSC__JSValue JSC__JSValue__jsNull() { return JSC::JSValue::encode(JSC::jsNull()); };
JSC__JSValue JSC__JSValue__jsNumberFromChar(char arg0) { return JSC::JSValue::encode(JSC::jsNumber(arg0));};
JSC__JSValue JSC__JSValue__jsNumberFromDouble(double arg0) { return JSC::JSValue::encode(JSC::jsNumber(arg0));};
JSC__JSValue JSC__JSValue__jsNumberFromInt32(int32_t arg0) { return JSC::JSValue::encode(JSC::jsNumber(arg0));};
JSC__JSValue JSC__JSValue__jsNumberFromInt64(int64_t arg0) { return JSC::JSValue::encode(JSC::jsNumber(arg0));};
JSC__JSValue JSC__JSValue__jsNumberFromU16(uint16_t arg0) { return JSC::JSValue::encode(JSC::jsNumber(arg0));};
JSC__JSValue JSC__JSValue__jsNumberFromUint64(uint64_t arg0) { return JSC::JSValue::encode(JSC::jsNumber(arg0));};
JSC__JSValue JSC__JSValue__jsTDZValue() { return JSC::JSValue::encode(JSC::jsTDZValue()); };
JSC__JSValue JSC__JSValue__jsUndefined() { return JSC::JSValue::encode(JSC::jsUndefined()); };
JSC__JSObject* JSC__JSValue__toObject(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1) {
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return value.toObject(arg1);
}

bJSC__Identifier JSC__JSValue__toPropertyKey(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1) {
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    auto ident = value.toPropertyKey(arg1);
    return cast<bJSC__Identifier>(&ident);
}
JSC__JSValue JSC__JSValue__toPropertyKeyValue(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1) {
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return JSC::JSValue::encode(value.toPropertyKeyValue(arg1));
}
JSC__JSString* JSC__JSValue__toString(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1) {
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return value.toString(arg1);
};
JSC__JSString* JSC__JSValue__toStringOrNull(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1) {
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return value.toStringOrNull(arg1);
}


#pragma mark - JSC::PropertyName

bool JSC__PropertyName__eqlToIdentifier(JSC__PropertyName* arg0, const JSC__Identifier* arg1) {
    return (*arg0) == (*arg1);
};
bool JSC__PropertyName__eqlToPropertyName(JSC__PropertyName* arg0, const JSC__PropertyName* arg1) {
    return (*arg0) == (*arg1);
};
const WTF__StringImpl* JSC__PropertyName__publicName(JSC__PropertyName* arg0) {
    return arg0->publicName();
};
const WTF__StringImpl* JSC__PropertyName__uid(JSC__PropertyName* arg0) {
    return arg0->uid();
};


#pragma mark - JSC::VM

JSC__JSLock* JSC__VM__apiLock(JSC__VM* arg0) {
    return makeRefPtr((*arg0).apiLock()).leakRef();
}
JSC__VM* JSC__VM__create(char HeapType0) {
    JSC::VM* vm = &JSC::VM::create(HeapType0 == JSC::SmallHeap ? JSC::SmallHeap : JSC::LargeHeap).leakRef();
    #if ENABLE(WEBASSEMBLY)
        JSC::Wasm::enableFastMemory();
    #endif

    return vm;
}
void JSC__VM__deinit(JSC__VM* arg1, JSC__JSGlobalObject* globalObject) {
    JSC::VM& vm = reinterpret_cast<JSC::VM&>(arg1);
    bool protectCountIsZero = vm.heap.unprotect(globalObject);
    
    if (protectCountIsZero)
        vm.heap.reportAbandonedObjectGraph();
        
    vm.deref();
}
void JSC__VM__drainMicrotasks(JSC__VM* arg0) {
    arg0->drainMicrotasks();
}

bool JSC__VM__executionForbidden(JSC__VM* arg0) {
    return (*arg0).executionForbidden();
}

bool JSC__VM__isEntered(JSC__VM* arg0) {
    return (*arg0).isEntered();
}

void JSC__VM__setExecutionForbidden(JSC__VM* arg0, bool arg1) {
    (*arg0).setExecutionForbidden();
}

bool JSC__VM__throwError(JSC__VM* arg0, JSC__JSGlobalObject* arg1, JSC__ThrowScope* arg2, const char* arg3, size_t arg4) {
    auto scope = arg2;
    auto global = arg1;
    const String& message = WTF::String(arg3, arg4);
   return JSC::throwException(global, (*scope), createError(global, message));
}

#pragma mark - JSC::ThrowScope

void JSC__ThrowScope__clearException(JSC__ThrowScope* arg0) {
    arg0->clearException();
};
bJSC__ThrowScope JSC__ThrowScope__declare(JSC__VM* arg0, char* arg1, char* arg2, size_t arg3) {
    JSC::ThrowScope scope = JSC::ThrowScope(reinterpret_cast<JSC::VM&>(arg0));
    return cast<bJSC__ThrowScope>(&scope);
};
JSC__Exception* JSC__ThrowScope__exception(JSC__ThrowScope* arg0) {
    return arg0->exception();
}
void JSC__ThrowScope__release(JSC__ThrowScope* arg0) {
    arg0->release();
}

#pragma mark - JSC::CatchScope

void JSC__CatchScope__clearException(JSC__CatchScope* arg0) {
    arg0->clearException();
}
bJSC__CatchScope JSC__CatchScope__declare(JSC__VM* arg0, char* arg1, char* arg2, size_t arg3) {
    JSC::CatchScope scope = JSC::CatchScope(reinterpret_cast<JSC::VM&>(arg0));
    return cast<bJSC__CatchScope>(&scope);
}
JSC__Exception* JSC__CatchScope__exception(JSC__CatchScope* arg0) {
    return arg0->exception();
}


#pragma mark - JSC::CallFrame

JSC__JSValue JSC__CallFrame__argument(const JSC__CallFrame* arg0, uint16_t arg1) {
    return JSC::JSValue::encode(arg0->argument(arg1));
};
size_t JSC__CallFrame__argumentsCount(const JSC__CallFrame* arg0) {
    return arg0->argumentCount();
}
JSC__JSObject* JSC__CallFrame__jsCallee(const JSC__CallFrame* arg0) {
    return arg0->jsCallee();
}
JSC__JSValue JSC__CallFrame__newTarget(const JSC__CallFrame* arg0) {
    return JSC::JSValue::encode(arg0->newTarget());
};
JSC__JSValue JSC__CallFrame__thisValue(const JSC__CallFrame* arg0) {
    return JSC::JSValue::encode(arg0->thisValue());
}
JSC__JSValue JSC__CallFrame__uncheckedArgument(const JSC__CallFrame* arg0, uint16_t arg1) {
    return JSC::JSValue::encode(arg0->uncheckedArgument(arg1));
}

#pragma mark - JSC::Identifier

bool JSC__Identifier__eqlIdent(const JSC__Identifier* arg0, const JSC__Identifier* arg1) {
    return arg0 == arg1;
};
bool JSC__Identifier__eqlStringImpl(const JSC__Identifier* arg0, const WTF__StringImpl* arg1) {
    return JSC::Identifier::equal(arg0->string().impl(), arg1);
};
bool JSC__Identifier__eqlUTF8(const JSC__Identifier* arg0, const char* arg1, size_t arg2) {
    return JSC::Identifier::equal(arg0->string().impl(), reinterpret_cast<const LChar*>(arg1), arg2);
};
bool JSC__Identifier__neqlIdent(const JSC__Identifier* arg0, const JSC__Identifier* arg1) {
    return arg0 != arg1;
}
bool JSC__Identifier__neqlStringImpl(const JSC__Identifier* arg0, const WTF__StringImpl* arg1) {
    return !JSC::Identifier::equal(arg0->string().impl(), arg1);
};

bJSC__Identifier JSC__Identifier__fromSlice(JSC__VM* arg0, const char* arg1, size_t arg2) {
    JSC::Identifier ident = JSC::Identifier::fromString(reinterpret_cast<JSC__VM&>(arg0), reinterpret_cast<const LChar*>(arg1), static_cast<int>(arg2));
    return cast<bJSC__Identifier>(&ident);
};
bJSC__Identifier JSC__Identifier__fromString(JSC__VM* arg0, const WTF__String* arg1) {
    JSC::Identifier ident = JSC::Identifier::fromString(reinterpret_cast<JSC__VM&>(arg0), reinterpret_cast<const WTF__String&>(arg1));
    return cast<bJSC__Identifier>(&ident);
};
// bJSC__Identifier JSC__Identifier__fromUid(JSC__VM* arg0, const WTF__StringImpl* arg1) {
//     auto ident = JSC::Identifier::fromUid(&arg0, &arg1);
//     return *cast<bJSC__Identifier>(&ident);
// };
bool JSC__Identifier__isEmpty(const JSC__Identifier* arg0) {
        return arg0->isEmpty();
};
bool JSC__Identifier__isNull(const JSC__Identifier* arg0) {
    return arg0->isNull();
};
bool JSC__Identifier__isPrivateName(const JSC__Identifier* arg0) {
    return arg0->isPrivateName();
};
bool JSC__Identifier__isSymbol(const JSC__Identifier* arg0) {
        return arg0->isSymbol();
};
size_t JSC__Identifier__length(const JSC__Identifier* arg0) {
    return arg0->length();
};

bWTF__String JSC__Identifier__toString(const JSC__Identifier* arg0) {
    auto string = arg0->string();
    return cast<bWTF__String>(&string);
};


#pragma mark - WTF::StringView

const uint16_t* WTF__StringView__characters16(const WTF__StringView* arg0) {
    WTF::StringView* view = (WTF::StringView*)arg0;
    return reinterpret_cast<const uint16_t*>(view->characters16());
}
const char* WTF__StringView__characters8(const WTF__StringView* arg0) {
    return reinterpret_cast<const char*>(arg0->characters8()); 
};

bool WTF__StringView__is16Bit(const WTF__StringView* arg0) {return !arg0->is8Bit(); };
bool WTF__StringView__is8Bit(const WTF__StringView* arg0) {return arg0->is8Bit(); };
bool WTF__StringView__isEmpty(const WTF__StringView* arg0) {return arg0->isEmpty(); };
size_t WTF__StringView__length(const WTF__StringView* arg0) {return arg0->length(); };

#pragma mark - WTF::StringImpl

const uint16_t* WTF__StringImpl__characters16(const WTF__StringImpl* arg0) {
    return reinterpret_cast<const uint16_t*>(arg0->characters16());
}
const char* WTF__StringImpl__characters8(const WTF__StringImpl* arg0) {
    return reinterpret_cast<const char*>(arg0->characters8()); 
}

bWTF__StringView WTF__StringView__from8Bit(const char* arg0, size_t arg1) {
     WTF::StringView view = WTF::StringView(arg0, arg1);
    return cast<bWTF__StringView>(&view);
}

bool WTF__StringImpl__is16Bit(const WTF__StringImpl* arg0) {
    return !arg0->is8Bit();
}
bool WTF__StringImpl__is8Bit(const WTF__StringImpl* arg0) {
    return arg0->is8Bit();
}
bool WTF__StringImpl__isEmpty(const WTF__StringImpl* arg0) {
    return arg0->isEmpty();
}
bool WTF__StringImpl__isExternal(const WTF__StringImpl* arg0) {
    return arg0->isExternal();
}
bool WTF__StringImpl__isStatic(const WTF__StringImpl* arg0) {
    return arg0->isStatic();
}
size_t WTF__StringImpl__length(const WTF__StringImpl* arg0) {
    return arg0->length();
}


#pragma mark - WTF::ExternalStringImpl

const uint16_t* WTF__ExternalStringImpl__characters16(const WTF__ExternalStringImpl* arg0) {
    return reinterpret_cast<const uint16_t*>(arg0->characters16());
}
const char* WTF__ExternalStringImpl__characters8(const WTF__ExternalStringImpl* arg0) {
    return reinterpret_cast<const char*>(arg0->characters8()); 
}



bool WTF__ExternalStringImpl__is16Bit(const WTF__ExternalStringImpl* arg0) {
    return !arg0->is8Bit();
}
bool WTF__ExternalStringImpl__is8Bit(const WTF__ExternalStringImpl* arg0) {
    return arg0->is8Bit();
}
bool WTF__ExternalStringImpl__isEmpty(const WTF__ExternalStringImpl* arg0) {
    return arg0->isEmpty();
}
bool WTF__ExternalStringImpl__isExternal(const WTF__ExternalStringImpl* arg0) {
    return arg0->isExternal();
}
bool WTF__ExternalStringImpl__isStatic(const WTF__ExternalStringImpl* arg0) {
    return arg0->isStatic();
}
size_t WTF__ExternalStringImpl__length(const WTF__ExternalStringImpl* arg0) {
    return arg0->length();
}

#pragma mark - WTF::String

const uint16_t* WTF__String__characters16(WTF__String* arg0) { 
    return reinterpret_cast<const uint16_t*>(arg0->characters16());
};
 const char* WTF__String__characters8(WTF__String* arg0) {
    return reinterpret_cast<const char*>(arg0->characters8()); 
};

 bool WTF__String__eqlSlice(WTF__String* arg0, const char* arg1, size_t arg2) {
    return WTF::equal(arg0->impl(), reinterpret_cast<const LChar*>(arg1), arg2);
}
 bool WTF__String__eqlString(WTF__String* arg0, const WTF__String* arg1) {
    return arg0 == arg1;
}
 const WTF__StringImpl* WTF__String__impl(WTF__String* arg0) {
    return arg0->impl();
 }

bool WTF__String__is16Bit(WTF__String* arg0) {return !arg0->is8Bit();}
bool WTF__String__is8Bit(WTF__String* arg0) {return arg0->is8Bit();}
bool WTF__String__isEmpty(WTF__String* arg0) {return arg0->isEmpty();}
bool WTF__String__isExternal(WTF__String* arg0) {return arg0->impl()->isExternal();}
bool WTF__String__isStatic(WTF__String* arg0) {return arg0->impl()->isStatic();}
size_t WTF__String__length(WTF__String* arg0) {return arg0->length();}

bWTF__String WTF__String__createFromExternalString(bWTF__ExternalStringImpl arg0) {
    WTF::ExternalStringImpl* external = cast<WTF::ExternalStringImpl*>(&arg0);
    WTF::String string = WTF::String(external);
    return ccast<bWTF__String>(&string);
};
bWTF__String WTF__String__createWithoutCopyingFromPtr(const char* arg0, size_t arg1) {
    const WTF::String string = WTF::String(WTF::StringImpl::createWithoutCopying(reinterpret_cast<const LChar*>(arg0), arg1));
    return ccast<bWTF__String>(&string);
}

#pragma mark - WTF::URL

bWTF__StringView WTF__URL__encodedPassword(WTF__URL* arg0) {
    auto result = arg0->encodedPassword();
    return cast<bWTF__StringView>(&result);
};
bWTF__StringView WTF__URL__encodedUser(WTF__URL* arg0) {
    auto result =  arg0->encodedUser();
    return cast<bWTF__StringView>(&result);
};
bWTF__String WTF__URL__fileSystemPath(WTF__URL* arg0) {
    auto result = arg0->fileSystemPath();
    return cast<bWTF__String>(&result);
};
bWTF__StringView WTF__URL__fragmentIdentifier(WTF__URL* arg0) {
    auto result = arg0->fragmentIdentifier();
    return cast<bWTF__StringView>(&result);
};
bWTF__StringView WTF__URL__fragmentIdentifierWithLeadingNumberSign(WTF__URL* arg0) {
    auto result = arg0->fragmentIdentifierWithLeadingNumberSign();
    return cast<bWTF__StringView>(&result);
};
bWTF__URL WTF__URL__fromFileSystemPath(bWTF__StringView arg0) {
    auto url = WTF::URL::fileURLWithFileSystemPath(cast<WTF::StringView>(&arg0));
      return cast<bWTF__URL>(&url);
};
bWTF__URL WTF__URL__fromString(bWTF__String arg0, bWTF__String arg1) {
    WTF::URL url= WTF::URL(WTF::URL(), cast<WTF::String>(&arg1));
    return cast<bWTF__URL>(&url);
};
bWTF__StringView WTF__URL__host(WTF__URL* arg0) {
    auto result = arg0->host();
    return cast<bWTF__StringView>(&result);
};
bWTF__String WTF__URL__hostAndPort(WTF__URL* arg0) {
    auto result = arg0->hostAndPort();
    return cast<bWTF__String>(&result);
};
bool WTF__URL__isEmpty(const WTF__URL* arg0) {
    return arg0->isEmpty();
};
bool WTF__URL__isValid(const WTF__URL* arg0) {
    return arg0->isValid();
};
bWTF__StringView WTF__URL__lastPathComponent(WTF__URL* arg0) {
    auto result = arg0->lastPathComponent();
    return cast<bWTF__StringView>(&result);
};
bWTF__String WTF__URL__password(WTF__URL* arg0) {
    auto result = arg0->password();
    return cast<bWTF__String>(&result);
};
bWTF__StringView WTF__URL__path(WTF__URL* arg0) {
    auto result = arg0->path();
    return cast<bWTF__StringView>(&result);
};
bWTF__StringView WTF__URL__protocol(WTF__URL* arg0) {
    auto result = arg0->protocol();
    return cast<bWTF__StringView>(&result);
};
bWTF__String WTF__URL__protocolHostAndPort(WTF__URL* arg0) {
    auto result = arg0->protocolHostAndPort();
    return cast<bWTF__String>(&result);
};
bWTF__StringView WTF__URL__query(WTF__URL* arg0) {
    auto result = arg0->query();
    return cast<bWTF__StringView>(&result);
};
bWTF__StringView WTF__URL__queryWithLeadingQuestionMark(WTF__URL* arg0) {
    auto result = arg0->queryWithLeadingQuestionMark();
    return cast<bWTF__StringView>(&result);
};
bWTF__String WTF__URL__stringWithoutFragmentIdentifier(WTF__URL* arg0) {
    auto result = arg0->stringWithoutFragmentIdentifier();
    return cast<bWTF__String>(&result);
};
bWTF__StringView WTF__URL__stringWithoutQueryOrFragmentIdentifier(WTF__URL* arg0) {
    auto result = arg0->stringWithoutQueryOrFragmentIdentifier();
    return cast<bWTF__StringView>(&result);
};
bWTF__URL WTF__URL__truncatedForUseAsBase(WTF__URL* arg0) {
    auto result = arg0->truncatedForUseAsBase();
    return cast<bWTF__URL>(&result);
};
bWTF__String WTF__URL__user(WTF__URL* arg0) {
    auto result = arg0->user();
    return cast<bWTF__String>(&result);
};

void WTF__URL__setHost(WTF__URL* arg0, bWTF__StringView arg1) {
    arg0->setHost(cast<WTF::StringView>(&arg1));
};
void WTF__URL__setHostAndPort(WTF__URL* arg0, bWTF__StringView arg1) {
    arg0->setHostAndPort(cast<WTF::StringView>(&arg1));
};
void WTF__URL__setPassword(WTF__URL* arg0, bWTF__StringView arg1) {
    arg0->setPassword(cast<WTF::StringView>(&arg1));
};
void WTF__URL__setPath(WTF__URL* arg0, bWTF__StringView arg1) {
    arg0->setPath(cast<WTF::StringView>(&arg1));
};
void WTF__URL__setProtocol(WTF__URL* arg0, bWTF__StringView arg1) {
    arg0->setProtocol(cast<WTF::StringView>(&arg1));
};
void WTF__URL__setQuery(WTF__URL* arg0, bWTF__StringView arg1) {
    arg0->setQuery(cast<WTF::StringView>(&arg1));
};
void WTF__URL__setUser(WTF__URL* arg0, bWTF__StringView arg1) {
    arg0->setUser(cast<WTF::StringView>(&arg1));
};

}




