#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>
#define ZIG_DECL extern
#define CPP_DECL extern 


#pragma mark - JSC::JSObject

#ifndef BINDINGS__decls__JavaScriptCore_JSObject_h
#define BINDINGS__decls__JavaScriptCore_JSObject_h
#include <JavaScriptCore/JSObject.h>
namespace JSC {
 class JSObject;
}
#endif

CPP_DECL "C" bool JSC__JSObject__hasProperty(JSC::JSObject* arg0, JSC::JSGlobalObject* arg1, JSC::PropertyName* arg2);
CPP_DECL "C" JSC::PropertyNameArray* JSC__JSObject__getPropertyNames(JSC::JSObject* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL "C" size_t JSC__JSObject__getArrayLength(JSC::JSObject* arg0);
CPP_DECL "C" JSC::JSValue JSC__JSObject__getDirect(JSC::JSObject* arg0, JSC::JSGlobalObject* arg1, JSC::PropertyName* arg2);
CPP_DECL "C" bool JSC__JSObject__putDirect(JSC::JSObject* arg0, JSC::JSGlobalObject* arg1, JSC::PropertyName* arg2, JSC::JSValue arg3);
CPP_DECL "C" JSC::JSValue JSC__JSObject__get(JSC::JSObject* arg0, JSC::JSGlobalObject* arg1, JSC::PropertyName* arg2);
CPP_DECL "C" JSC::JSValue JSC__JSObject__getAtIndex(JSC::JSObject* arg0, JSC::JSGlobalObject* arg1, JSC::PropertyName* arg2, uint32_t arg3);
CPP_DECL "C" bool JSC__JSObject__putAtIndex(JSC::JSObject* arg0, JSC::JSGlobalObject* arg1, JSC::PropertyName* arg2, uint32_t arg3);
CPP_DECL "C" JSC::JSValue JSC__JSObject__getIfExists(JSC::JSObject* arg0, JSC::JSGlobalObject* arg1, JSC::PropertyName* arg2);

#pragma mark - JSC::PropertyNameArray

#ifndef BINDINGS__decls__JavaScriptCore_PropertyNameArray_h
#define BINDINGS__decls__JavaScriptCore_PropertyNameArray_h
#include <JavaScriptCore/PropertyNameArray.h>
namespace JSC {
 class PropertyNameArray;
}
#endif

CPP_DECL "C" size_t JSC__PropertyNameArray__length(JSC::PropertyNameArray* arg0);
CPP_DECL "C" void JSC__PropertyNameArray__release(JSC::PropertyNameArray* arg0);
CPP_DECL "C" const JSC::PropertyName* JSC__PropertyNameArray__next(JSC::PropertyNameArray* arg0, size_t arg1);

#pragma mark - JSC::JSCell

#ifndef BINDINGS__decls__JavaScriptCore_JSCell_h
#define BINDINGS__decls__JavaScriptCore_JSCell_h
#include <JavaScriptCore/JSCell.h>
namespace JSC {
 class JSCell;
}
#endif

CPP_DECL "C" JSC::JSObject* JSC__JSCell__getObject(JSC::JSCell* arg0);
CPP_DECL "C" WTF::WTFString* JSC__JSCell__getString(JSC::JSCell* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL "C" char JSC__JSCell__getType(JSC::JSCell* arg0);

#pragma mark - JSC::JSString

#ifndef BINDINGS__decls__JavaScriptCore_JSString_h
#define BINDINGS__decls__JavaScriptCore_JSString_h
#include <JavaScriptCore/JSString.h>
namespace JSC {
 class JSString;
}
#endif

CPP_DECL "C" JSC::JSObject* JSC__JSString__getObject(JSC::JSString* arg0);
CPP_DECL "C" bool JSC__JSString__eql(const JSC::JSString* arg0, const JSC::JSString* arg1);
CPP_DECL "C" WTF::WTFString* JSC__JSString__value(JSC::JSString* arg0, JSC::JSGlobalObject* arg1);
CPP_DECL "C" size_t JSC__JSString__length(const JSC::JSString* arg0);
CPP_DECL "C" bool JSC__JSString__is8Bit(const JSC::JSString* arg0);
CPP_DECL "C" bool JSC__JSString__createFromOwnedString(JSC::VM* arg0, WTF::StringImpl* arg1);
CPP_DECL "C" bool JSC__JSString__createFromString(JSC::VM* arg0, WTF::StringImpl* arg1);

#pragma mark - JSC::JSPromise

#ifndef BINDINGS__decls__JavaScriptCore_JSPromise_h
#define BINDINGS__decls__JavaScriptCore_JSPromise_h
#include <JavaScriptCore/JSPromise.h>
namespace JSC {
 class JSPromise;
}
#endif

CPP_DECL "C" uint32_t JSC__JSPromise__status(JSC::JSPromise* arg0, JSC::VM* arg1);
CPP_DECL "C" JSC::JSValue JSC__JSPromise__result(JSC::JSPromise* arg0, JSC::VM* arg1);
CPP_DECL "C" bool JSC__JSPromise__isHandled(JSC::JSPromise* arg0, JSC::VM* arg1);
CPP_DECL "C" JSC::JSPromise* JSC__JSPromise__resolvedPromise(JSC::JSGlobalObject* arg0, JSC::JSValue arg1);
CPP_DECL "C" JSC::JSPromise* JSC__JSPromise__rejectedPromise(JSC::JSGlobalObject* arg0, JSC::JSValue arg1);
CPP_DECL "C" void JSC__JSPromise__resolve(JSC::JSGlobalObject* arg0, JSC::JSValue arg1);
CPP_DECL "C" void JSC__JSPromise__reject(JSC::JSPromise* arg0, JSC::JSGlobalObject* arg1, JSC::JSValue arg2);
CPP_DECL "C" void JSC__JSPromise__rejectAsHandled(JSC::JSPromise* arg0, JSC::JSGlobalObject* arg1, JSC::JSValue arg2);
CPP_DECL "C" void JSC__JSPromise__rejectException(JSC::JSPromise* arg0, JSC::JSGlobalObject* arg1, JSC::Exception* arg2);
CPP_DECL "C" void JSC__JSPromise__rejectAsHandledException(JSC::JSPromise* arg0, JSC::JSGlobalObject* arg1, JSC::Exception* arg2);
CPP_DECL "C" bool JSC__JSPromise__isInternal(JSC::JSPromise* arg0, JSC::VM* arg1);
CPP_DECL "C" JSC::JSPromise* JSC__JSPromise__createDeferred(JSC::JSGlobalObject* arg0, JSC::JSFunction* arg1, JSC::JSFunction* arg2, JSC::Exception* arg3);

#pragma mark - JSC::SourceOrigin

#ifndef BINDINGS__decls__JavaScriptCore_SourceOrigin_h
#define BINDINGS__decls__JavaScriptCore_SourceOrigin_h
#include <JavaScriptCore/SourceOrigin.h>
namespace JSC {
 class SourceOrigin;
}
#endif

CPP_DECL "C" const JSC::SourceOrigin* JSC__SourceOrigin__fromURL(const WTF::URL* arg0);

#pragma mark - JSC::SourceCode

#ifndef BINDINGS__decls__JavaScriptCore_SourceProvider_h
#define BINDINGS__decls__JavaScriptCore_SourceProvider_h
#include <JavaScriptCore/SourceProvider.h>
namespace JSC {
 class SourceCode;
}
#endif

CPP_DECL "C" const JSC::SourceCode* JSC__SourceCode__fromString(const WTF::WTFString* arg0, const JSC::SourceOrigin* arg1, WTF::WTFString* arg2, char SourceType3);

#pragma mark - JSC::JSFunction

#ifndef BINDINGS__decls__JavaScriptCore_JSFunction_h
#define BINDINGS__decls__JavaScriptCore_JSFunction_h
#include <JavaScriptCore/JSFunction.h>
namespace JSC {
 class JSFunction;
}
#endif

CPP_DECL "C" JSC::JSFunction* JSC__JSFunction__createFromSourceCode(JSC::SourceCode* arg0, JSC::SourceOrigin* arg1, JSC::Exception* arg2);
CPP_DECL "C" JSC::JSFunction* JSC__JSFunction__createFromNative(JSC::VM* arg0, JSC::JSGlobalObject* arg1, uint32_t arg2, WTF::WTFString* arg3, void* arg4);
CPP_DECL "C" WTF::WTFString* JSC__JSFunction__getName(JSC::JSFunction* arg0, JSC::VM* arg1);
CPP_DECL "C" WTF::WTFString* JSC__JSFunction__displayName(JSC::JSFunction* arg0, JSC::VM* arg1);
CPP_DECL "C" WTF::WTFString* JSC__JSFunction__calculatedDisplayName(JSC::JSFunction* arg0, JSC::VM* arg1);
CPP_DECL "C" JSC::JSValue JSC__JSFunction__callWithArgumentsAndThis(JSC::JSFunction* arg0, JSC::JSValue arg1, JSC::JSGlobalObject* arg2, JSC::JSValue* arg3, size_t arg4, JSC::Exception** arg5, char* arg6);
CPP_DECL "C" JSC::JSValue JSC__JSFunction__callWithArguments(JSC::JSFunction* arg0, JSC::JSGlobalObject* arg1, JSC::JSValue* arg2, size_t arg3, JSC::Exception** arg4, char* arg5);
CPP_DECL "C" JSC::JSValue JSC__JSFunction__callWithThis(JSC::JSFunction* arg0, JSC::JSGlobalObject* arg1, JSC::JSValue arg2, JSC::Exception** arg3, char* arg4);
CPP_DECL "C" JSC::JSValue JSC__JSFunction__callWithoutAnyArgumentsOrThis(JSC::JSFunction* arg0, JSC::JSGlobalObject* arg1, JSC::Exception** arg2, char* arg3);
CPP_DECL "C" JSC::JSValue JSC__JSFunction__constructWithArgumentsAndNewTarget(JSC::JSFunction* arg0, JSC::JSValue arg1, JSC::JSGlobalObject* arg2, JSC::JSValue* arg3, size_t arg4, JSC::Exception** arg5, char* arg6);
CPP_DECL "C" JSC::JSValue JSC__JSFunction__constructWithArguments(JSC::JSFunction* arg0, JSC::JSGlobalObject* arg1, JSC::JSValue* arg2, size_t arg3, JSC::Exception** arg4, char* arg5);
CPP_DECL "C" JSC::JSValue JSC__JSFunction__constructWithNewTarget(JSC::JSFunction* arg0, JSC::JSGlobalObject* arg1, JSC::JSValue arg2, JSC::Exception** arg3, char* arg4);
CPP_DECL "C" JSC::JSValue JSC__JSFunction__constructWithoutAnyArgumentsOrNewTarget(JSC::JSFunction* arg0, JSC::JSGlobalObject* arg1, JSC::Exception** arg2, char* arg3);

#pragma mark - JSC::JSGlobalObject

#ifndef BINDINGS__decls__JavaScriptCore_JSGlobalObject_h
#define BINDINGS__decls__JavaScriptCore_JSGlobalObject_h
#include <JavaScriptCore/JSGlobalObject.h>
namespace JSC {
 class JSGlobalObject;
}
#endif

CPP_DECL "C" JSC::ObjectPrototype* JSC__JSGlobalObject__objectPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::FunctionPrototype* JSC__JSGlobalObject__functionPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::ArrayPrototype* JSC__JSGlobalObject__arrayPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::JSObject* JSC__JSGlobalObject__booleanPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::StringPrototype* JSC__JSGlobalObject__stringPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::JSObject* JSC__JSGlobalObject__numberPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::BigIntPrototype* JSC__JSGlobalObject__bigIntPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::JSObject* JSC__JSGlobalObject__datePrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::JSObject* JSC__JSGlobalObject__symbolPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::RegExpPrototype* JSC__JSGlobalObject__regExpPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::JSObject* JSC__JSGlobalObject__errorPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::IteratorPrototype* JSC__JSGlobalObject__iteratorPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::AsyncIteratorPrototype* JSC__JSGlobalObject__asyncIteratorPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::GeneratorFunctionPrototype* JSC__JSGlobalObject__generatorFunctionPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::GeneratorPrototype* JSC__JSGlobalObject__generatorPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::AsyncFunctionPrototype* JSC__JSGlobalObject__asyncFunctionPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::ArrayIteratorPrototype* JSC__JSGlobalObject__arrayIteratorPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::MapIteratorPrototype* JSC__JSGlobalObject__mapIteratorPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::SetIteratorPrototype* JSC__JSGlobalObject__setIteratorPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::JSObject* JSC__JSGlobalObject__mapPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::JSObject* JSC__JSGlobalObject__jsSetPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::JSPromisePrototype* JSC__JSGlobalObject__promisePrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::AsyncGeneratorPrototype* JSC__JSGlobalObject__asyncGeneratorPrototype(JSC::JSGlobalObject* arg0);
CPP_DECL "C" JSC::AsyncGeneratorFunctionPrototype* JSC__JSGlobalObject__asyncGeneratorFunctionPrototype(JSC::JSGlobalObject* arg0);

#pragma mark - WTF::URL

#ifndef BINDINGS__decls__wtf_URL_h
#define BINDINGS__decls__wtf_URL_h
#include <wtf/URL.h>
namespace WTF {
 class URL;
}
#endif

CPP_DECL "C" WTF::URL* WTF__URL__fromFileSystemPath(const WTF::StringView* arg0);
CPP_DECL "C" WTF::URL* WTF__URL__fromString(const WTF::WTFString* arg0, const WTF::WTFString* arg1);
CPP_DECL "C" bool WTF__URL__isEmpty(const WTF::URL* arg0);
CPP_DECL "C" bool WTF__URL__isValid(const WTF::URL* arg0);
CPP_DECL "C" const WTF::StringView* WTF__URL__protocol(WTF::URL* arg0);
CPP_DECL "C" const WTF::StringView* WTF__URL__encodedUser(WTF::URL* arg0);
CPP_DECL "C" const WTF::StringView* WTF__URL__encodedPassword(WTF::URL* arg0);
CPP_DECL "C" const WTF::StringView* WTF__URL__host(WTF::URL* arg0);
CPP_DECL "C" const WTF::StringView* WTF__URL__path(WTF::URL* arg0);
CPP_DECL "C" const WTF::StringView* WTF__URL__lastPathComponent(WTF::URL* arg0);
CPP_DECL "C" const WTF::StringView* WTF__URL__query(WTF::URL* arg0);
CPP_DECL "C" const WTF::StringView* WTF__URL__fragmentIdentifier(WTF::URL* arg0);
CPP_DECL "C" const WTF::StringView* WTF__URL__queryWithLeadingQuestionMark(WTF::URL* arg0);
CPP_DECL "C" const WTF::StringView* WTF__URL__fragmentIdentifierWithLeadingNumberSign(WTF::URL* arg0);
CPP_DECL "C" const WTF::StringView* WTF__URL__stringWithoutQueryOrFragmentIdentifier(WTF::URL* arg0);
CPP_DECL "C" const WTF::StringView* WTF__URL__stringWithoutFragmentIdentifier(WTF::URL* arg0);
CPP_DECL "C" const WTF::WTFString* WTF__URL__protocolHostAndPort(WTF::URL* arg0);
CPP_DECL "C" const WTF::WTFString* WTF__URL__hostAndPort(WTF::URL* arg0);
CPP_DECL "C" const WTF::WTFString* WTF__URL__user(WTF::URL* arg0);
CPP_DECL "C" const WTF::WTFString* WTF__URL__password(WTF::URL* arg0);
CPP_DECL "C" const WTF::WTFString* WTF__URL__fileSystemPath(WTF::URL* arg0);
CPP_DECL "C" void WTF__URL__setProtocol(WTF::URL* arg0, const WTF::StringView* arg1);
CPP_DECL "C" void WTF__URL__setHost(WTF::URL* arg0, const WTF::StringView* arg1);
CPP_DECL "C" void WTF__URL__setHostAndPort(WTF::URL* arg0, const WTF::StringView* arg1);
CPP_DECL "C" void WTF__URL__setUser(WTF::URL* arg0, const WTF::StringView* arg1);
CPP_DECL "C" void WTF__URL__setPassword(WTF::URL* arg0, const WTF::StringView* arg1);
CPP_DECL "C" void WTF__URL__setPath(WTF::URL* arg0, const WTF::StringView* arg1);
CPP_DECL "C" void WTF__URL__setQuery(WTF::URL* arg0, const WTF::StringView* arg1);
CPP_DECL "C" WTF::URL* WTF__URL__truncatedForUseAsBase(WTF::URL* arg0);

#pragma mark - WTF::WTFString

#ifndef BINDINGS__decls__wtf_text_WTFString_h
#define BINDINGS__decls__wtf_text_WTFString_h
#include <wtf/text/WTFString.h>
namespace WTF {
 class WTFString;
}
#endif

CPP_DECL "C" bool WTF__WTFString__is8Bit(WTF::WTFString* arg0);
CPP_DECL "C" bool WTF__WTFString__is16Bit(WTF::WTFString* arg0);
CPP_DECL "C" bool WTF__WTFString__isExternal(WTF::WTFString* arg0);
CPP_DECL "C" bool WTF__WTFString__isStatic(WTF::WTFString* arg0);
CPP_DECL "C" bool WTF__WTFString__isEmpty(WTF::WTFString* arg0);
CPP_DECL "C" size_t WTF__WTFString__length(WTF::WTFString* arg0);
CPP_DECL "C" char* WTF__WTFString__characters8(WTF::WTFString* arg0);
CPP_DECL "C" char* WTF__WTFString__characters16(WTF::WTFString* arg0);
CPP_DECL "C" WTF::WTFString* WTF__WTFString__createWithoutCopyingFromPtr(const char* arg0, size_t arg1);
CPP_DECL "C" bool WTF__WTFString__eqlString(WTF::WTFString* arg0, WTF::WTFString* arg1);
CPP_DECL "C" bool WTF__WTFString__eqlSlice(WTF::WTFString* arg0, char* arg1, size_t arg2);
CPP_DECL "C" WTF::StringImpl* WTF__WTFString__impl(WTF::WTFString* arg0);
CPP_DECL "C" WTF::WTFString* WTF__WTFString__createFromExternalString(WTF::StringImpl* arg0);

#pragma mark - JSC::JSValue

#ifndef BINDINGS__decls__JavaScriptCore_JSValue_h
#define BINDINGS__decls__JavaScriptCore_JSValue_h
#include <JavaScriptCore/JSValue.h>
namespace JSC {
 class JSValue;
}
#endif

CPP_DECL "C" uint64_t JSC__JSValue__encode(JSC::JSValue arg0);
CPP_DECL "C" JSC::JSString* JSC__JSValue__asString(JSC::JSValue arg0);
CPP_DECL "C" JSC::JSString* JSC__JSValue__asObject(JSC::JSValue arg0);
CPP_DECL "C" JSC::JSString* JSC__JSValue__asNumber(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isError(JSC::JSValue arg0);
CPP_DECL "C" JSC::JSValue JSC__JSValue__jsNull();
CPP_DECL "C" JSC::JSValue JSC__JSValue__jsUndefined();
CPP_DECL "C" JSC::JSValue JSC__JSValue__jsTDZValue();
CPP_DECL "C" JSC::JSValue JSC__JSValue__jsBoolean(bool arg0);
CPP_DECL "C" JSC::JSValue JSC__JSValue__jsDoubleNumber(double arg0);
CPP_DECL "C" JSC::JSValue JSC__JSValue__jsNumberFromDouble(double arg0);
CPP_DECL "C" JSC::JSValue JSC__JSValue__jsNumberFromChar(char arg0);
CPP_DECL "C" JSC::JSValue JSC__JSValue__jsNumberFromU16(uint16_t arg0);
CPP_DECL "C" JSC::JSValue JSC__JSValue__jsNumberFromInt32(int32_t arg0);
CPP_DECL "C" JSC::JSValue JSC__JSValue__jsNumberFromInt64(int64_t arg0);
CPP_DECL "C" JSC::JSValue JSC__JSValue__jsNumberFromUint64(uint64_t arg0);
CPP_DECL "C" bool JSC__JSValue__isUndefined(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isNull(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isUndefinedOrNull(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isBoolean(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isAnyInt(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isUInt32AsAnyInt(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isInt32AsAnyInt(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isNumber(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isString(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isBigInt(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isHeapBigInt(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isBigInt32(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isSymbol(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isPrimitive(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isGetterSetter(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isCustomGetterSetter(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isObject(JSC::JSValue arg0);
CPP_DECL "C" bool JSC__JSValue__isCell(JSC::JSValue arg0);
CPP_DECL "C" JSC::JSCell* JSC__JSValue__asCell(JSC::JSValue arg0);
CPP_DECL "C" JSC::JSString* JSC__JSValue__toString(JSC::JSValue arg0, JSC::JSGlobalObject* arg1);
CPP_DECL "C" JSC::JSString* JSC__JSValue__toStringOrNull(JSC::JSValue arg0, JSC::JSGlobalObject* arg1);
CPP_DECL "C" JSC::Identifier* JSC__JSValue__toPropertyKey(JSC::JSValue arg0, JSC::JSGlobalObject* arg1);
CPP_DECL "C" JSC::JSValue JSC__JSValue__toPropertyKeyValue(JSC::JSValue arg0, JSC::JSGlobalObject* arg1);
CPP_DECL "C" JSC::JSObject* JSC__JSValue__toObject(JSC::JSValue arg0, JSC::JSGlobalObject* arg1);
CPP_DECL "C" WTF::WTFString* JSC__JSValue__toWTFString(JSC::JSValue arg0);
CPP_DECL "C" JSC::JSValue JSC__JSValue__getPrototype(JSC::JSValue arg0, JSC::JSGlobalObject* arg1);
CPP_DECL "C" JSC::JSValue JSC__JSValue__getPropertyByPropertyName(JSC::JSValue arg0, JSC::PropertyName* arg1, JSC::JSGlobalObject* arg2);
CPP_DECL "C" bool JSC__JSValue__eqlValue(JSC::JSValue arg0, JSC::JSValue arg1);
CPP_DECL "C" bool JSC__JSValue__eqlCell(JSC::JSValue arg0, JSC::JSCell* arg1);

#pragma mark - JSC::PropertyName

#ifndef BINDINGS__decls__JavaScriptCore_PropertyName_h
#define BINDINGS__decls__JavaScriptCore_PropertyName_h
#include <JavaScriptCore/PropertyName.h>
namespace JSC {
 class PropertyName;
}
#endif

CPP_DECL "C" bool JSC__PropertyName__eqlToPropertyName(JSC::PropertyName* arg0, const JSC::PropertyName* arg1);
CPP_DECL "C" bool JSC__PropertyName__eqlToIdentifier(JSC::PropertyName* arg0, const JSC::Identifier* arg1);
CPP_DECL "C" WTF::StringImpl* JSC__PropertyName__publicName(JSC::PropertyName* arg0);
CPP_DECL "C" WTF::StringImpl* JSC__PropertyName__uid(JSC::PropertyName* arg0);

#pragma mark - JSC::Exception

#ifndef BINDINGS__decls__JavaScriptCore_Exception_h
#define BINDINGS__decls__JavaScriptCore_Exception_h
#include <JavaScriptCore/Exception.h>
namespace JSC {
 class Exception;
}
#endif

CPP_DECL "C" JSC::Exception* JSC__Exception__create(JSC::JSGlobalObject* arg0, JSC::JSObject* arg1, char StackCaptureAction2);

#pragma mark - JSC::VM

#ifndef BINDINGS__decls__JavaScriptCore_VM_h
#define BINDINGS__decls__JavaScriptCore_VM_h
#include <JavaScriptCore/VM.h>
namespace JSC {
 class VM;
}
#endif

CPP_DECL "C" JSC::VM* JSC__VM__create(char HeapType0);
CPP_DECL "C" void JSC__VM__deinit(JSC::VM* arg0);
CPP_DECL "C" void JSC__VM__setExecutionForbidden(JSC::VM* arg0, bool arg1);
CPP_DECL "C" bool JSC__VM__executionForbidden(JSC::VM* arg0);
CPP_DECL "C" bool JSC__VM__isEntered(JSC::VM* arg0);
CPP_DECL "C" bool JSC__VM__throwError(JSC::VM* arg0, JSC::ExceptionScope* arg1, const char* arg2, size_t arg3);

#pragma mark - JSC::ExceptionScope

#ifndef BINDINGS__decls__JavaScriptCore_ExceptionScope_h
#define BINDINGS__decls__JavaScriptCore_ExceptionScope_h
#include <JavaScriptCore/ExceptionScope.h>
namespace JSC {
 class ExceptionScope;
}
#endif

CPP_DECL "C" void JSC__ExceptionScope__release(JSC::ExceptionScope* arg0);
CPP_DECL "C" JSC::ExceptionScope* JSC__ExceptionScope__declareThrowScope(JSC::VM* arg0, char* arg1, char* arg2, size_t arg3);
CPP_DECL "C" JSC::ExceptionScope* JSC__ExceptionScope__declareCatchScope(JSC::VM* arg0, char* arg1, char* arg2, size_t arg3);
CPP_DECL "C" void JSC__ExceptionScope__release(JSC::ExceptionScope* arg0);
CPP_DECL "C" JSC::Exception* JSC__ExceptionScope__exception(JSC::ExceptionScope* arg0);
CPP_DECL "C" void JSC__ExceptionScope__clearException(JSC::ExceptionScope* arg0);

#pragma mark - JSC::CallFrame

#ifndef BINDINGS__decls__JavaScriptCore_CallFrame_h
#define BINDINGS__decls__JavaScriptCore_CallFrame_h
#include <JavaScriptCore/CallFrame.h>
namespace JSC {
 class CallFrame;
}
#endif

CPP_DECL "C" size_t JSC__CallFrame__argumentsCount(const JSC::CallFrame* arg0);
CPP_DECL "C" JSC::JSValue JSC__CallFrame__uncheckedArgument(const JSC::CallFrame* arg0, uint16_t arg1);
CPP_DECL "C" JSC::JSValue JSC__CallFrame__argument(const JSC::CallFrame* arg0, uint16_t arg1);
CPP_DECL "C" JSC::JSValue JSC__CallFrame__thisValue(const JSC::CallFrame* arg0);
CPP_DECL "C" JSC::JSValue JSC__CallFrame__newTarget(const JSC::CallFrame* arg0);
CPP_DECL "C" JSC::JSObject* JSC__CallFrame__jsCallee(const JSC::CallFrame* arg0);

#pragma mark - JSC::Identifier

#ifndef BINDINGS__decls__JavaScriptCore_Identifier_h
#define BINDINGS__decls__JavaScriptCore_Identifier_h
#include <JavaScriptCore/Identifier.h>
namespace JSC {
 class Identifier;
}
#endif

CPP_DECL "C" JSC::Identifier* JSC__Identifier__fromString(JSC::VM* arg0, WTF::WTFString* arg1);
CPP_DECL "C" JSC::Identifier* JSC__Identifier__fromSlice(JSC::VM* arg0, char* arg1, size_t arg2);
CPP_DECL "C" JSC::Identifier* JSC__Identifier__fromUid(JSC::VM* arg0, WTF::StringImpl* arg1);
CPP_DECL "C" void JSC__Identifier__deinit(JSC::VM* arg0);
CPP_DECL "C" WTF::WTFString* JSC__Identifier__toString(JSC::Identifier* arg0);
CPP_DECL "C" size_t JSC__Identifier__length(JSC::Identifier* arg0);
CPP_DECL "C" bool JSC__Identifier__isNull(JSC::Identifier* arg0);
CPP_DECL "C" bool JSC__Identifier__isEmpty(JSC::Identifier* arg0);
CPP_DECL "C" bool JSC__Identifier__isSymbol(JSC::Identifier* arg0);
CPP_DECL "C" bool JSC__Identifier__isPrivateName(JSC::Identifier* arg0);
CPP_DECL "C" bool JSC__Identifier__eqlIdent(JSC::Identifier* arg0, JSC::Identifier* arg1);
CPP_DECL "C" bool JSC__Identifier__neqlIdent(JSC::Identifier* arg0, JSC::Identifier* arg1);
CPP_DECL "C" bool JSC__Identifier__eqlStringImpl(JSC::Identifier* arg0, WTF::StringImpl* arg1);
CPP_DECL "C" bool JSC__Identifier__neqlStringImpl(JSC::Identifier* arg0, WTF::StringImpl* arg1);
CPP_DECL "C" bool JSC__Identifier__eqlUTF8(JSC::Identifier* arg0, char* arg1, size_t arg2);

#pragma mark - WTF::StringImpl

#ifndef BINDINGS__decls__WTF_text_StringImpl_h
#define BINDINGS__decls__WTF_text_StringImpl_h
#include <WTF/text/StringImpl.h>
namespace WTF {
 class StringImpl;
}
#endif

CPP_DECL "C" bool WTF__StringImpl__is8Bit(WTF::StringImpl* arg0);
CPP_DECL "C" bool WTF__StringImpl__is16Bit(WTF::StringImpl* arg0);
CPP_DECL "C" bool WTF__StringImpl__isExternal(WTF::StringImpl* arg0);
CPP_DECL "C" bool WTF__StringImpl__isStatic(WTF::StringImpl* arg0);
CPP_DECL "C" bool WTF__StringImpl__isEmpty(WTF::StringImpl* arg0);
CPP_DECL "C" size_t WTF__StringImpl__length(WTF::StringImpl* arg0);
CPP_DECL "C" char* WTF__StringImpl__characters8(WTF::StringImpl* arg0);
CPP_DECL "C" uint16_t* WTF__StringImpl__characters16(WTF::StringImpl* arg0);

#pragma mark - WTF::StringView

#ifndef BINDINGS__decls__WTF_text_StringView_h
#define BINDINGS__decls__WTF_text_StringView_h
#include <WTF/text/StringView.h>
namespace WTF {
 class StringView;
}
#endif

CPP_DECL "C" WTF::StringView* WTF__StringView__from8Bit(const char* arg0, size_t arg1);
CPP_DECL "C" bool WTF__StringView__is8Bit(WTF::StringView* arg0);
CPP_DECL "C" bool WTF__StringView__is16Bit(WTF::StringView* arg0);
CPP_DECL "C" bool WTF__StringView__isEmpty(WTF::StringView* arg0);
CPP_DECL "C" size_t WTF__StringView__length(WTF::StringView* arg0);
CPP_DECL "C" char* WTF__StringView__characters8(WTF::StringView* arg0);
CPP_DECL "C" uint16_t* WTF__StringView__characters16(WTF::StringView* arg0);
