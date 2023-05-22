namespace Zig { class GlobalObject; }
#include "root.h"
#include "config.h"
#include "JSDOMGlobalObject.h"
#include "WebCoreJSClientData.h"
#include <JavaScriptCore/JSObjectInlines.h>
#include "WebCoreJSBuiltins.h"

namespace WebCore {

/* BundlerPlugin.ts */
// runSetupFunction
const JSC::ConstructAbility s_bundlerPluginRunSetupFunctionCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_bundlerPluginRunSetupFunctionCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_bundlerPluginRunSetupFunctionCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_bundlerPluginRunSetupFunctionCodeLength = 2213;
static const JSC::Intrinsic s_bundlerPluginRunSetupFunctionCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_bundlerPluginRunSetupFunctionCode = "(function (_,h){\"use strict\";var w=new Map,q=new Map;function z(J,K,M){if(!J||!@isObject(J))@throwTypeError('Expected an object with \"filter\" RegExp');if(!K||!@isCallable(K))@throwTypeError(\"callback must be a function\");var{filter:N,namespace:Q=\"file\"}=J;if(!N)@throwTypeError('Expected an object with \"filter\" RegExp');if(!@isRegExpObject(N))@throwTypeError(\"filter must be a RegExp\");if(Q&&typeof Q!==\"string\")@throwTypeError(\"namespace must be a string\");if((Q\?.length\?\?0)===0)Q=\"file\";if(!/^([/@a-zA-Z0-9_\\\\-]+)$/.test(Q))@throwTypeError(\"namespace can only contain $a-zA-Z0-9_\\\\-\");var T=M.@get(Q);if(!T)M.@set(Q,[[N,K]]);else @arrayPush(T,[N,K])}function A(J,K){z(J,K,w)}function B(J,K){z(J,K,q)}function C(J){@throwTypeError(`@{@2} is not implemented yet. See https://github.com/oven-sh/bun/issues/@1`)}function E(J){@throwTypeError(`@{@2} is not implemented yet. See https://github.com/oven-sh/bun/issues/@1`)}function F(J){@throwTypeError(`@{@2} is not implemented yet. See https://github.com/oven-sh/bun/issues/@1`)}function G(J){@throwTypeError(`@{@2} is not implemented yet. See https://github.com/oven-sh/bun/issues/@1`)}const H=()=>{var J=!1,K=!1;for(var[M,N]of w.entries())for(var[Q]of N)this.addFilter(Q,M,1),J=!0;for(var[M,N]of q.entries())for(var[Q]of N)this.addFilter(Q,M,0),K=!0;if(K){var T=this.onResolve;if(!T)this.onResolve=q;else for(var[M,N]of q.entries()){var U=T.@get(M);if(!U)T.@set(M,N);else T.@set(M,U.concat(N))}}if(J){var V=this.onLoad;if(!V)this.onLoad=w;else for(var[M,N]of w.entries()){var U=V.@get(M);if(!U)V.@set(M,N);else V.@set(M,U.concat(N))}}return J||K};var I=_({config:h,onDispose:F,onEnd:E,onLoad:A,onResolve:B,onStart:C,resolve:G,initialOptions:{...h,bundle:!0,entryPoints:h.entrypoints\?\?h.entryPoints\?\?[],minify:typeof h.minify===\"boolean\"\?h.minify:!1,minifyIdentifiers:h.minify===!0||h.minify\?.identifiers,minifyWhitespace:h.minify===!0||h.minify\?.whitespace,minifySyntax:h.minify===!0||h.minify\?.syntax,outbase:h.root,platform:h.target===\"bun\"\?\"node\":h.target},esbuild:{}});if(I&&@isPromise(I))if(@getPromiseInternalField(I,@promiseFieldFlags)&@promiseStateFulfilled)I=@getPromiseInternalField(I,@promiseFieldReactionsOrResult);else return I.@then(H);return H()})\n";

// runOnResolvePlugins
const JSC::ConstructAbility s_bundlerPluginRunOnResolvePluginsCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_bundlerPluginRunOnResolvePluginsCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_bundlerPluginRunOnResolvePluginsCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_bundlerPluginRunOnResolvePluginsCodeLength = 1711;
static const JSC::Intrinsic s_bundlerPluginRunOnResolvePluginsCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_bundlerPluginRunOnResolvePluginsCode = "(function (_,v,y,O,b){\"use strict\";const g=[\"entry-point\",\"import-statement\",\"require-call\",\"dynamic-import\",\"require-resolve\",\"import-rule\",\"url-token\",\"internal\"][b];var j=(async(q,w,z,A)=>{var{onResolve:B,onLoad:C}=this,E=B.@get(w);if(!E)return this.onResolveAsync(O,null,null,null),null;for(let[K,M]of E)if(K.test(q)){var F=M({path:q,importer:z,namespace:w,kind:A});while(F&&@isPromise(F)&&(@getPromiseInternalField(F,@promiseFieldFlags)&@promiseStateMask)===@promiseStateFulfilled)F=@getPromiseInternalField(F,@promiseFieldReactionsOrResult);if(F&&@isPromise(F))F=await F;if(!F||!@isObject(F))continue;var{path:G,namespace:H=w,external:J}=F;if(typeof G!==\"string\"||typeof H!==\"string\")@throwTypeError(\"onResolve plugins must return an object with a string 'path' and string 'loader' field\");if(!G)continue;if(!H)H=w;if(typeof J!==\"boolean\"&&!@isUndefinedOrNull(J))@throwTypeError('onResolve plugins \"external\" field must be boolean or unspecified');if(!J){if(H===\"file\"){if(darwin!==\"win32\"){if(G[0]!==\"/\"||G.includes(\"..\"))@throwTypeError('onResolve plugin \"path\" must be absolute when the namespace is \"file\"')}}if(H===\"dataurl\"){if(!G.startsWith(\"data:\"))@throwTypeError('onResolve plugin \"path\" must start with \"data:\" when the namespace is \"dataurl\"')}if(H&&H!==\"file\"&&(!C||!C.@has(H)))@throwTypeError(`Expected onLoad plugin for namespace ${H} to exist`)}return this.onResolveAsync(O,G,H,J),null}return this.onResolveAsync(O,null,null,null),null})(_,v,y,g);while(j&&@isPromise(j)&&(@getPromiseInternalField(j,@promiseFieldFlags)&@promiseStateMask)===@promiseStateFulfilled)j=@getPromiseInternalField(j,@promiseFieldReactionsOrResult);if(j&&@isPromise(j))j.then(()=>{},(q)=>{this.addError(O,q,0)})})\n";

// runOnLoadPlugins
const JSC::ConstructAbility s_bundlerPluginRunOnLoadPluginsCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_bundlerPluginRunOnLoadPluginsCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_bundlerPluginRunOnLoadPluginsCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_bundlerPluginRunOnLoadPluginsCodeLength = 1330;
static const JSC::Intrinsic s_bundlerPluginRunOnLoadPluginsCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_bundlerPluginRunOnLoadPluginsCode = "(function (_,g,b,j){\"use strict\";const q={jsx:0,js:1,ts:2,tsx:3,css:4,file:5,json:6,toml:7,wasm:8,napi:9,base64:10,dataurl:11,text:12},v=[\"jsx\",\"js\",\"ts\",\"tsx\",\"css\",\"file\",\"json\",\"toml\",\"wasm\",\"napi\",\"base64\",\"dataurl\",\"text\"][j];var w=(async(x,y,z,B)=>{var C=this.onLoad.@get(z);if(!C)return this.onLoadAsync(x,null,null,null),null;for(let[H,J]of C)if(H.test(y)){var E=J({path:y,namespace:z,loader:B});while(E&&@isPromise(E)&&(@getPromiseInternalField(E,@promiseFieldFlags)&@promiseStateMask)===@promiseStateFulfilled)E=@getPromiseInternalField(E,@promiseFieldReactionsOrResult);if(E&&@isPromise(E))E=await E;if(!E||!@isObject(E))continue;var{contents:F,loader:G=B}=E;if(typeof F!==\"string\"&&!@isTypedArrayView(F))@throwTypeError('onLoad plugins must return an object with \"contents\" as a string or Uint8Array');if(typeof G!==\"string\")@throwTypeError('onLoad plugins must return an object with \"loader\" as a string');const K=q[G];if(K===@undefined)@throwTypeError(`Loader ${G} is not supported.`);return this.onLoadAsync(x,F,K),null}return this.onLoadAsync(x,null,null),null})(_,g,b,v);while(w&&@isPromise(w)&&(@getPromiseInternalField(w,@promiseFieldFlags)&@promiseStateMask)===@promiseStateFulfilled)w=@getPromiseInternalField(w,@promiseFieldReactionsOrResult);if(w&&@isPromise(w))w.then(()=>{},(x)=>{this.addError(_,x,1)})})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().bundlerPluginBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().bundlerPluginBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ByteLengthQueuingStrategy.ts */
// highWaterMark
const JSC::ConstructAbility s_byteLengthQueuingStrategyHighWaterMarkCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_byteLengthQueuingStrategyHighWaterMarkCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_byteLengthQueuingStrategyHighWaterMarkCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_byteLengthQueuingStrategyHighWaterMarkCodeLength = 210;
static const JSC::Intrinsic s_byteLengthQueuingStrategyHighWaterMarkCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_byteLengthQueuingStrategyHighWaterMarkCode = "(function (){\"use strict\";const n=@getByIdDirectPrivate(this,\"highWaterMark\");if(n===@undefined)@throwTypeError(\"ByteLengthQueuingStrategy.highWaterMark getter called on incompatible |this| value.\");return n})\n";

// size
const JSC::ConstructAbility s_byteLengthQueuingStrategySizeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_byteLengthQueuingStrategySizeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_byteLengthQueuingStrategySizeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_byteLengthQueuingStrategySizeCodeLength = 49;
static const JSC::Intrinsic s_byteLengthQueuingStrategySizeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_byteLengthQueuingStrategySizeCode = "(function (r){\"use strict\";return r.byteLength})\n";

// initializeByteLengthQueuingStrategy
const JSC::ConstructAbility s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCodeLength = 121;
static const JSC::Intrinsic s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCode = "(function (h){\"use strict\";@putByIdDirectPrivate(this,\"highWaterMark\",@extractHighWaterMarkFromQueuingStrategyInit(h))})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().byteLengthQueuingStrategyBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().byteLengthQueuingStrategyBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_BYTELENGTHQUEUINGSTRATEGY_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* WritableStreamInternals.ts */
// isWritableStream
const JSC::ConstructAbility s_writableStreamInternalsIsWritableStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsIsWritableStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsIsWritableStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsIsWritableStreamCodeLength = 94;
static const JSC::Intrinsic s_writableStreamInternalsIsWritableStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsIsWritableStreamCode = "(function (d){\"use strict\";return @isObject(d)&&!!@getByIdDirectPrivate(d,\"underlyingSink\")})\n";

// isWritableStreamDefaultWriter
const JSC::ConstructAbility s_writableStreamInternalsIsWritableStreamDefaultWriterCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsIsWritableStreamDefaultWriterCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsIsWritableStreamDefaultWriterCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsIsWritableStreamDefaultWriterCodeLength = 93;
static const JSC::Intrinsic s_writableStreamInternalsIsWritableStreamDefaultWriterCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsIsWritableStreamDefaultWriterCode = "(function (d){\"use strict\";return @isObject(d)&&!!@getByIdDirectPrivate(d,\"closedPromise\")})\n";

// acquireWritableStreamDefaultWriter
const JSC::ConstructAbility s_writableStreamInternalsAcquireWritableStreamDefaultWriterCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsAcquireWritableStreamDefaultWriterCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsAcquireWritableStreamDefaultWriterCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsAcquireWritableStreamDefaultWriterCodeLength = 72;
static const JSC::Intrinsic s_writableStreamInternalsAcquireWritableStreamDefaultWriterCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsAcquireWritableStreamDefaultWriterCode = "(function (d){\"use strict\";return new @WritableStreamDefaultWriter(d)})\n";

// createWritableStream
const JSC::ConstructAbility s_writableStreamInternalsCreateWritableStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsCreateWritableStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsCreateWritableStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsCreateWritableStreamCodeLength = 278;
static const JSC::Intrinsic s_writableStreamInternalsCreateWritableStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsCreateWritableStreamCode = "(function (d,u,_,f,j,p){\"use strict\";@assert(typeof j===\"number\"&&!@isNaN(j)&&j>=0);const q={};@initializeWritableStreamSlots(q,{});const v=new @WritableStreamDefaultController;return @setUpWritableStreamDefaultController(q,v,d,u,_,f,j,p),@createWritableStreamFromInternal(q)})\n";

// createInternalWritableStreamFromUnderlyingSink
const JSC::ConstructAbility s_writableStreamInternalsCreateInternalWritableStreamFromUnderlyingSinkCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsCreateInternalWritableStreamFromUnderlyingSinkCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsCreateInternalWritableStreamFromUnderlyingSinkCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsCreateInternalWritableStreamFromUnderlyingSinkCodeLength = 956;
static const JSC::Intrinsic s_writableStreamInternalsCreateInternalWritableStreamFromUnderlyingSinkCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsCreateInternalWritableStreamFromUnderlyingSinkCode = "(function (f,o){\"use strict\";const _={};if(f===@undefined)f={};if(o===@undefined)o={};if(!@isObject(f))@throwTypeError(\"WritableStream constructor takes an object as first argument\");if(\"type\"in f)@throwRangeError(\"Invalid type is specified\");const p=@extractSizeAlgorithm(o),w=@extractHighWaterMark(o,1),b={};if(\"start\"in f){if(b[\"start\"]=f[\"start\"],typeof b[\"start\"]!==\"function\")@throwTypeError(\"underlyingSink.start should be a function\")}if(\"write\"in f){if(b[\"write\"]=f[\"write\"],typeof b[\"write\"]!==\"function\")@throwTypeError(\"underlyingSink.write should be a function\")}if(\"close\"in f){if(b[\"close\"]=f[\"close\"],typeof b[\"close\"]!==\"function\")@throwTypeError(\"underlyingSink.close should be a function\")}if(\"abort\"in f){if(b[\"abort\"]=f[\"abort\"],typeof b[\"abort\"]!==\"function\")@throwTypeError(\"underlyingSink.abort should be a function\")}return @initializeWritableStreamSlots(_,f),@setUpWritableStreamDefaultControllerFromUnderlyingSink(_,f,b,w,p),_})\n";

// initializeWritableStreamSlots
const JSC::ConstructAbility s_writableStreamInternalsInitializeWritableStreamSlotsCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsInitializeWritableStreamSlotsCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsInitializeWritableStreamSlotsCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsInitializeWritableStreamSlotsCodeLength = 588;
static const JSC::Intrinsic s_writableStreamInternalsInitializeWritableStreamSlotsCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsInitializeWritableStreamSlotsCode = "(function (_,c){\"use strict\";@putByIdDirectPrivate(_,\"state\",\"writable\"),@putByIdDirectPrivate(_,\"storedError\",@undefined),@putByIdDirectPrivate(_,\"writer\",@undefined),@putByIdDirectPrivate(_,\"controller\",@undefined),@putByIdDirectPrivate(_,\"inFlightWriteRequest\",@undefined),@putByIdDirectPrivate(_,\"closeRequest\",@undefined),@putByIdDirectPrivate(_,\"inFlightCloseRequest\",@undefined),@putByIdDirectPrivate(_,\"pendingAbortRequest\",@undefined),@putByIdDirectPrivate(_,\"writeRequests\",@createFIFO()),@putByIdDirectPrivate(_,\"backpressure\",!1),@putByIdDirectPrivate(_,\"underlyingSink\",c)})\n";

// writableStreamCloseForBindings
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamCloseForBindingsCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamCloseForBindingsCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamCloseForBindingsCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamCloseForBindingsCodeLength = 370;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamCloseForBindingsCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamCloseForBindingsCode = "(function (n){\"use strict\";if(@isWritableStreamLocked(n))return @Promise.@reject(@makeTypeError(\"WritableStream.close method can only be used on non locked WritableStream\"));if(@writableStreamCloseQueuedOrInFlight(n))return @Promise.@reject(@makeTypeError(\"WritableStream.close method can only be used on a being close WritableStream\"));return @writableStreamClose(n)})\n";

// writableStreamAbortForBindings
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamAbortForBindingsCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamAbortForBindingsCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamAbortForBindingsCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamAbortForBindingsCodeLength = 211;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamAbortForBindingsCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamAbortForBindingsCode = "(function (d,n){\"use strict\";if(@isWritableStreamLocked(d))return @Promise.@reject(@makeTypeError(\"WritableStream.abort method can only be used on non locked WritableStream\"));return @writableStreamAbort(d,n)})\n";

// isWritableStreamLocked
const JSC::ConstructAbility s_writableStreamInternalsIsWritableStreamLockedCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsIsWritableStreamLockedCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsIsWritableStreamLockedCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsIsWritableStreamLockedCodeLength = 83;
static const JSC::Intrinsic s_writableStreamInternalsIsWritableStreamLockedCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsIsWritableStreamLockedCode = "(function (d){\"use strict\";return @getByIdDirectPrivate(d,\"writer\")!==@undefined})\n";

// setUpWritableStreamDefaultWriter
const JSC::ConstructAbility s_writableStreamInternalsSetUpWritableStreamDefaultWriterCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsSetUpWritableStreamDefaultWriterCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsSetUpWritableStreamDefaultWriterCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsSetUpWritableStreamDefaultWriterCodeLength = 887;
static const JSC::Intrinsic s_writableStreamInternalsSetUpWritableStreamDefaultWriterCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsSetUpWritableStreamDefaultWriterCode = "(function (n,u){\"use strict\";if(@isWritableStreamLocked(u))@throwTypeError(\"WritableStream is locked\");@putByIdDirectPrivate(n,\"stream\",u),@putByIdDirectPrivate(u,\"writer\",n);const _=@newPromiseCapability(@Promise),f=@newPromiseCapability(@Promise);@putByIdDirectPrivate(n,\"readyPromise\",_),@putByIdDirectPrivate(n,\"closedPromise\",f);const g=@getByIdDirectPrivate(u,\"state\");if(g===\"writable\"){if(@writableStreamCloseQueuedOrInFlight(u)||!@getByIdDirectPrivate(u,\"backpressure\"))_.@resolve.@call()}else if(g===\"erroring\")_.@reject.@call(@undefined,@getByIdDirectPrivate(u,\"storedError\")),@markPromiseAsHandled(_.@promise);else if(g===\"closed\")_.@resolve.@call(),f.@resolve.@call();else{@assert(g===\"errored\");const h=@getByIdDirectPrivate(u,\"storedError\");_.@reject.@call(@undefined,h),@markPromiseAsHandled(_.@promise),f.@reject.@call(@undefined,h),@markPromiseAsHandled(f.@promise)}})\n";

// writableStreamAbort
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamAbortCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamAbortCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamAbortCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamAbortCodeLength = 501;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamAbortCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamAbortCode = "(function (_,c){\"use strict\";const f=@getByIdDirectPrivate(_,\"state\");if(f===\"closed\"||f===\"errored\")return @Promise.@resolve();const h=@getByIdDirectPrivate(_,\"pendingAbortRequest\");if(h!==@undefined)return h.promise.@promise;@assert(f===\"writable\"||f===\"erroring\");let j=!1;if(f===\"erroring\")j=!0,c=@undefined;const k=@newPromiseCapability(@Promise);if(@putByIdDirectPrivate(_,\"pendingAbortRequest\",{promise:k,reason:c,wasAlreadyErroring:j}),!j)@writableStreamStartErroring(_,c);return k.@promise})\n";

// writableStreamClose
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamCloseCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamCloseCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamCloseCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamCloseCodeLength = 642;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamCloseCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamCloseCode = "(function (_){\"use strict\";const n=@getByIdDirectPrivate(_,\"state\");if(n===\"closed\"||n===\"errored\")return @Promise.@reject(@makeTypeError(\"Cannot close a writable stream that is closed or errored\"));@assert(n===\"writable\"||n===\"erroring\"),@assert(!@writableStreamCloseQueuedOrInFlight(_));const d=@newPromiseCapability(@Promise);@putByIdDirectPrivate(_,\"closeRequest\",d);const k=@getByIdDirectPrivate(_,\"writer\");if(k!==@undefined&&@getByIdDirectPrivate(_,\"backpressure\")&&n===\"writable\")@getByIdDirectPrivate(k,\"readyPromise\").@resolve.@call();return @writableStreamDefaultControllerClose(@getByIdDirectPrivate(_,\"controller\")),d.@promise})\n";

// writableStreamAddWriteRequest
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamAddWriteRequestCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamAddWriteRequestCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamAddWriteRequestCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamAddWriteRequestCodeLength = 227;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamAddWriteRequestCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamAddWriteRequestCode = "(function (d){\"use strict\";@assert(@isWritableStreamLocked(d)),@assert(@getByIdDirectPrivate(d,\"state\")===\"writable\");const n=@newPromiseCapability(@Promise);return @getByIdDirectPrivate(d,\"writeRequests\").push(n),n.@promise})\n";

// writableStreamCloseQueuedOrInFlight
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamCloseQueuedOrInFlightCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamCloseQueuedOrInFlightCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamCloseQueuedOrInFlightCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamCloseQueuedOrInFlightCodeLength = 151;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamCloseQueuedOrInFlightCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamCloseQueuedOrInFlightCode = "(function (n){\"use strict\";return @getByIdDirectPrivate(n,\"closeRequest\")!==@undefined||@getByIdDirectPrivate(n,\"inFlightCloseRequest\")!==@undefined})\n";

// writableStreamDealWithRejection
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDealWithRejectionCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDealWithRejectionCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDealWithRejectionCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDealWithRejectionCodeLength = 189;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDealWithRejectionCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDealWithRejectionCode = "(function (_,d){\"use strict\";const n=@getByIdDirectPrivate(_,\"state\");if(n===\"writable\"){@writableStreamStartErroring(_,d);return}@assert(n===\"erroring\"),@writableStreamFinishErroring(_)})\n";

// writableStreamFinishErroring
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamFinishErroringCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamFinishErroringCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamFinishErroringCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamFinishErroringCodeLength = 1058;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamFinishErroringCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamFinishErroringCode = "(function (_){\"use strict\";@assert(@getByIdDirectPrivate(_,\"state\")===\"erroring\"),@assert(!@writableStreamHasOperationMarkedInFlight(_)),@putByIdDirectPrivate(_,\"state\",\"errored\");const d=@getByIdDirectPrivate(_,\"controller\");@getByIdDirectPrivate(d,\"errorSteps\").@call();const i=@getByIdDirectPrivate(_,\"storedError\"),n=@getByIdDirectPrivate(_,\"writeRequests\");for(var B=n.shift();B;B=n.shift())B.@reject.@call(@undefined,i);@putByIdDirectPrivate(_,\"writeRequests\",@createFIFO());const D=@getByIdDirectPrivate(_,\"pendingAbortRequest\");if(D===@undefined){@writableStreamRejectCloseAndClosedPromiseIfNeeded(_);return}if(@putByIdDirectPrivate(_,\"pendingAbortRequest\",@undefined),D.wasAlreadyErroring){D.promise.@reject.@call(@undefined,i),@writableStreamRejectCloseAndClosedPromiseIfNeeded(_);return}@getByIdDirectPrivate(d,\"abortSteps\").@call(@undefined,D.reason).@then(()=>{D.promise.@resolve.@call(),@writableStreamRejectCloseAndClosedPromiseIfNeeded(_)},(M)=>{D.promise.@reject.@call(@undefined,M),@writableStreamRejectCloseAndClosedPromiseIfNeeded(_)})})\n";

// writableStreamFinishInFlightClose
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamFinishInFlightCloseCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamFinishInFlightCloseCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamFinishInFlightCloseCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamFinishInFlightCloseCodeLength = 751;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamFinishInFlightCloseCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamFinishInFlightCloseCode = "(function (c){\"use strict\";@getByIdDirectPrivate(c,\"inFlightCloseRequest\").@resolve.@call(),@putByIdDirectPrivate(c,\"inFlightCloseRequest\",@undefined);const i=@getByIdDirectPrivate(c,\"state\");if(@assert(i===\"writable\"||i===\"erroring\"),i===\"erroring\"){@putByIdDirectPrivate(c,\"storedError\",@undefined);const f=@getByIdDirectPrivate(c,\"pendingAbortRequest\");if(f!==@undefined)f.promise.@resolve.@call(),@putByIdDirectPrivate(c,\"pendingAbortRequest\",@undefined)}@putByIdDirectPrivate(c,\"state\",\"closed\");const n=@getByIdDirectPrivate(c,\"writer\");if(n!==@undefined)@getByIdDirectPrivate(n,\"closedPromise\").@resolve.@call();@assert(@getByIdDirectPrivate(c,\"pendingAbortRequest\")===@undefined),@assert(@getByIdDirectPrivate(c,\"storedError\")===@undefined)})\n";

// writableStreamFinishInFlightCloseWithError
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamFinishInFlightCloseWithErrorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamFinishInFlightCloseWithErrorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamFinishInFlightCloseWithErrorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamFinishInFlightCloseWithErrorCodeLength = 488;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamFinishInFlightCloseWithErrorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamFinishInFlightCloseWithErrorCode = "(function (_,c){\"use strict\";const d=@getByIdDirectPrivate(_,\"inFlightCloseRequest\");@assert(d!==@undefined),d.@reject.@call(@undefined,c),@putByIdDirectPrivate(_,\"inFlightCloseRequest\",@undefined);const p=@getByIdDirectPrivate(_,\"state\");@assert(p===\"writable\"||p===\"erroring\");const i=@getByIdDirectPrivate(_,\"pendingAbortRequest\");if(i!==@undefined)i.promise.@reject.@call(@undefined,c),@putByIdDirectPrivate(_,\"pendingAbortRequest\",@undefined);@writableStreamDealWithRejection(_,c)})\n";

// writableStreamFinishInFlightWrite
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamFinishInFlightWriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamFinishInFlightWriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamFinishInFlightWriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamFinishInFlightWriteCodeLength = 187;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamFinishInFlightWriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamFinishInFlightWriteCode = "(function (d){\"use strict\";const c=@getByIdDirectPrivate(d,\"inFlightWriteRequest\");@assert(c!==@undefined),c.@resolve.@call(),@putByIdDirectPrivate(d,\"inFlightWriteRequest\",@undefined)})\n";

// writableStreamFinishInFlightWriteWithError
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamFinishInFlightWriteWithErrorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamFinishInFlightWriteWithErrorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamFinishInFlightWriteWithErrorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamFinishInFlightWriteWithErrorCodeLength = 319;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamFinishInFlightWriteWithErrorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamFinishInFlightWriteWithErrorCode = "(function (_,d){\"use strict\";const c=@getByIdDirectPrivate(_,\"inFlightWriteRequest\");@assert(c!==@undefined),c.@reject.@call(@undefined,d),@putByIdDirectPrivate(_,\"inFlightWriteRequest\",@undefined);const p=@getByIdDirectPrivate(_,\"state\");@assert(p===\"writable\"||p===\"erroring\"),@writableStreamDealWithRejection(_,d)})\n";

// writableStreamHasOperationMarkedInFlight
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamHasOperationMarkedInFlightCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamHasOperationMarkedInFlightCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamHasOperationMarkedInFlightCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamHasOperationMarkedInFlightCodeLength = 159;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamHasOperationMarkedInFlightCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamHasOperationMarkedInFlightCode = "(function (n){\"use strict\";return @getByIdDirectPrivate(n,\"inFlightWriteRequest\")!==@undefined||@getByIdDirectPrivate(n,\"inFlightCloseRequest\")!==@undefined})\n";

// writableStreamMarkCloseRequestInFlight
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamMarkCloseRequestInFlightCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamMarkCloseRequestInFlightCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamMarkCloseRequestInFlightCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamMarkCloseRequestInFlightCodeLength = 272;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamMarkCloseRequestInFlightCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamMarkCloseRequestInFlightCode = "(function (_){\"use strict\";const d=@getByIdDirectPrivate(_,\"closeRequest\");@assert(@getByIdDirectPrivate(_,\"inFlightCloseRequest\")===@undefined),@assert(d!==@undefined),@putByIdDirectPrivate(_,\"inFlightCloseRequest\",d),@putByIdDirectPrivate(_,\"closeRequest\",@undefined)})\n";

// writableStreamMarkFirstWriteRequestInFlight
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamMarkFirstWriteRequestInFlightCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamMarkFirstWriteRequestInFlightCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamMarkFirstWriteRequestInFlightCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamMarkFirstWriteRequestInFlightCodeLength = 240;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamMarkFirstWriteRequestInFlightCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamMarkFirstWriteRequestInFlightCode = "(function (_){\"use strict\";const d=@getByIdDirectPrivate(_,\"writeRequests\");@assert(@getByIdDirectPrivate(_,\"inFlightWriteRequest\")===@undefined),@assert(d.isNotEmpty());const n=d.shift();@putByIdDirectPrivate(_,\"inFlightWriteRequest\",n)})\n";

// writableStreamRejectCloseAndClosedPromiseIfNeeded
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamRejectCloseAndClosedPromiseIfNeededCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamRejectCloseAndClosedPromiseIfNeededCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamRejectCloseAndClosedPromiseIfNeededCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamRejectCloseAndClosedPromiseIfNeededCodeLength = 516;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamRejectCloseAndClosedPromiseIfNeededCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamRejectCloseAndClosedPromiseIfNeededCode = "(function (_){\"use strict\";@assert(@getByIdDirectPrivate(_,\"state\")===\"errored\");const n=@getByIdDirectPrivate(_,\"storedError\"),I=@getByIdDirectPrivate(_,\"closeRequest\");if(I!==@undefined)@assert(@getByIdDirectPrivate(_,\"inFlightCloseRequest\")===@undefined),I.@reject.@call(@undefined,n),@putByIdDirectPrivate(_,\"closeRequest\",@undefined);const p=@getByIdDirectPrivate(_,\"writer\");if(p!==@undefined){const b=@getByIdDirectPrivate(p,\"closedPromise\");b.@reject.@call(@undefined,n),@markPromiseAsHandled(b.@promise)}})\n";

// writableStreamStartErroring
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamStartErroringCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamStartErroringCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamStartErroringCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamStartErroringCodeLength = 544;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamStartErroringCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamStartErroringCode = "(function (d,g){\"use strict\";@assert(@getByIdDirectPrivate(d,\"storedError\")===@undefined),@assert(@getByIdDirectPrivate(d,\"state\")===\"writable\");const i=@getByIdDirectPrivate(d,\"controller\");@assert(i!==@undefined),@putByIdDirectPrivate(d,\"state\",\"erroring\"),@putByIdDirectPrivate(d,\"storedError\",g);const _=@getByIdDirectPrivate(d,\"writer\");if(_!==@undefined)@writableStreamDefaultWriterEnsureReadyPromiseRejected(_,g);if(!@writableStreamHasOperationMarkedInFlight(d)&&@getByIdDirectPrivate(i,\"started\")===1)@writableStreamFinishErroring(d)})\n";

// writableStreamUpdateBackpressure
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamUpdateBackpressureCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamUpdateBackpressureCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamUpdateBackpressureCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamUpdateBackpressureCodeLength = 422;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamUpdateBackpressureCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamUpdateBackpressureCode = "(function (i,n){\"use strict\";@assert(@getByIdDirectPrivate(i,\"state\")===\"writable\"),@assert(!@writableStreamCloseQueuedOrInFlight(i));const d=@getByIdDirectPrivate(i,\"writer\");if(d!==@undefined&&n!==@getByIdDirectPrivate(i,\"backpressure\"))if(n)@putByIdDirectPrivate(d,\"readyPromise\",@newPromiseCapability(@Promise));else @getByIdDirectPrivate(d,\"readyPromise\").@resolve.@call();@putByIdDirectPrivate(i,\"backpressure\",n)})\n";

// writableStreamDefaultWriterAbort
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultWriterAbortCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultWriterAbortCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultWriterAbortCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultWriterAbortCodeLength = 130;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultWriterAbortCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultWriterAbortCode = "(function (c,d){\"use strict\";const _=@getByIdDirectPrivate(c,\"stream\");return @assert(_!==@undefined),@writableStreamAbort(_,d)})\n";

// writableStreamDefaultWriterClose
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultWriterCloseCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultWriterCloseCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultWriterCloseCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultWriterCloseCodeLength = 126;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultWriterCloseCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultWriterCloseCode = "(function (n){\"use strict\";const d=@getByIdDirectPrivate(n,\"stream\");return @assert(d!==@undefined),@writableStreamClose(d)})\n";

// writableStreamDefaultWriterCloseWithErrorPropagation
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultWriterCloseWithErrorPropagationCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultWriterCloseWithErrorPropagationCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultWriterCloseWithErrorPropagationCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultWriterCloseWithErrorPropagationCodeLength = 385;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultWriterCloseWithErrorPropagationCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultWriterCloseWithErrorPropagationCode = "(function (n){\"use strict\";const d=@getByIdDirectPrivate(n,\"stream\");@assert(d!==@undefined);const _=@getByIdDirectPrivate(d,\"state\");if(@writableStreamCloseQueuedOrInFlight(d)||_===\"closed\")return @Promise.@resolve();if(_===\"errored\")return @Promise.@reject(@getByIdDirectPrivate(d,\"storedError\"));return @assert(_===\"writable\"||_===\"erroring\"),@writableStreamDefaultWriterClose(n)})\n";

// writableStreamDefaultWriterEnsureClosedPromiseRejected
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultWriterEnsureClosedPromiseRejectedCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultWriterEnsureClosedPromiseRejectedCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultWriterEnsureClosedPromiseRejectedCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultWriterEnsureClosedPromiseRejectedCodeLength = 329;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultWriterEnsureClosedPromiseRejectedCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultWriterEnsureClosedPromiseRejectedCode = "(function (n,u){\"use strict\";let B=@getByIdDirectPrivate(n,\"closedPromise\"),I=B.@promise;if((@getPromiseInternalField(I,@promiseFieldFlags)&@promiseStateMask)!==@promiseStatePending)B=@newPromiseCapability(@Promise),I=B.@promise,@putByIdDirectPrivate(n,\"closedPromise\",B);B.@reject.@call(@undefined,u),@markPromiseAsHandled(I)})\n";

// writableStreamDefaultWriterEnsureReadyPromiseRejected
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultWriterEnsureReadyPromiseRejectedCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultWriterEnsureReadyPromiseRejectedCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultWriterEnsureReadyPromiseRejectedCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultWriterEnsureReadyPromiseRejectedCodeLength = 327;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultWriterEnsureReadyPromiseRejectedCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultWriterEnsureReadyPromiseRejectedCode = "(function (n,_){\"use strict\";let c=@getByIdDirectPrivate(n,\"readyPromise\"),M=c.@promise;if((@getPromiseInternalField(M,@promiseFieldFlags)&@promiseStateMask)!==@promiseStatePending)c=@newPromiseCapability(@Promise),M=c.@promise,@putByIdDirectPrivate(n,\"readyPromise\",c);c.@reject.@call(@undefined,_),@markPromiseAsHandled(M)})\n";

// writableStreamDefaultWriterGetDesiredSize
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultWriterGetDesiredSizeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultWriterGetDesiredSizeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultWriterGetDesiredSizeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultWriterGetDesiredSizeCodeLength = 299;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultWriterGetDesiredSizeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultWriterGetDesiredSizeCode = "(function (n){\"use strict\";const d=@getByIdDirectPrivate(n,\"stream\");@assert(d!==@undefined);const c=@getByIdDirectPrivate(d,\"state\");if(c===\"errored\"||c===\"erroring\")return null;if(c===\"closed\")return 0;return @writableStreamDefaultControllerGetDesiredSize(@getByIdDirectPrivate(d,\"controller\"))})\n";

// writableStreamDefaultWriterRelease
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultWriterReleaseCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultWriterReleaseCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultWriterReleaseCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultWriterReleaseCodeLength = 414;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultWriterReleaseCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultWriterReleaseCode = "(function (n){\"use strict\";const c=@getByIdDirectPrivate(n,\"stream\");@assert(c!==@undefined),@assert(@getByIdDirectPrivate(c,\"writer\")===n);const f=@makeTypeError(\"writableStreamDefaultWriterRelease\");@writableStreamDefaultWriterEnsureReadyPromiseRejected(n,f),@writableStreamDefaultWriterEnsureClosedPromiseRejected(n,f),@putByIdDirectPrivate(c,\"writer\",@undefined),@putByIdDirectPrivate(n,\"stream\",@undefined)})\n";

// writableStreamDefaultWriterWrite
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultWriterWriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultWriterWriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultWriterWriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultWriterWriteCodeLength = 919;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultWriterWriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultWriterWriteCode = "(function (_,b){\"use strict\";const d=@getByIdDirectPrivate(_,\"stream\");@assert(d!==@undefined);const f=@getByIdDirectPrivate(d,\"controller\");@assert(f!==@undefined);const j=@writableStreamDefaultControllerGetChunkSize(f,b);if(d!==@getByIdDirectPrivate(_,\"stream\"))return @Promise.@reject(@makeTypeError(\"writer is not stream's writer\"));const E=@getByIdDirectPrivate(d,\"state\");if(E===\"errored\")return @Promise.@reject(@getByIdDirectPrivate(d,\"storedError\"));if(@writableStreamCloseQueuedOrInFlight(d)||E===\"closed\")return @Promise.@reject(@makeTypeError(\"stream is closing or closed\"));if(@writableStreamCloseQueuedOrInFlight(d)||E===\"closed\")return @Promise.@reject(@makeTypeError(\"stream is closing or closed\"));if(E===\"erroring\")return @Promise.@reject(@getByIdDirectPrivate(d,\"storedError\"));@assert(E===\"writable\");const I=@writableStreamAddWriteRequest(d);return @writableStreamDefaultControllerWrite(f,b,j),I})\n";

// setUpWritableStreamDefaultController
const JSC::ConstructAbility s_writableStreamInternalsSetUpWritableStreamDefaultControllerCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsSetUpWritableStreamDefaultControllerCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsSetUpWritableStreamDefaultControllerCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsSetUpWritableStreamDefaultControllerCodeLength = 700;
static const JSC::Intrinsic s_writableStreamInternalsSetUpWritableStreamDefaultControllerCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsSetUpWritableStreamDefaultControllerCode = "(function (d,_,u,v,y,S,f,j){\"use strict\";@assert(@isWritableStream(d)),@assert(@getByIdDirectPrivate(d,\"controller\")===@undefined),@putByIdDirectPrivate(_,\"stream\",d),@putByIdDirectPrivate(d,\"controller\",_),@resetQueue(@getByIdDirectPrivate(_,\"queue\")),@putByIdDirectPrivate(_,\"started\",-1),@putByIdDirectPrivate(_,\"startAlgorithm\",u),@putByIdDirectPrivate(_,\"strategySizeAlgorithm\",j),@putByIdDirectPrivate(_,\"strategyHWM\",f),@putByIdDirectPrivate(_,\"writeAlgorithm\",v),@putByIdDirectPrivate(_,\"closeAlgorithm\",y),@putByIdDirectPrivate(_,\"abortAlgorithm\",S);const q=@writableStreamDefaultControllerGetBackpressure(_);@writableStreamUpdateBackpressure(d,q),@writableStreamDefaultControllerStart(_)})\n";

// writableStreamDefaultControllerStart
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultControllerStartCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultControllerStartCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultControllerStartCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultControllerStartCodeLength = 647;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultControllerStartCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultControllerStartCode = "(function (d){\"use strict\";if(@getByIdDirectPrivate(d,\"started\")!==-1)return;@putByIdDirectPrivate(d,\"started\",0);const _=@getByIdDirectPrivate(d,\"startAlgorithm\");@putByIdDirectPrivate(d,\"startAlgorithm\",@undefined);const i=@getByIdDirectPrivate(d,\"stream\");return @Promise.@resolve(_.@call()).@then(()=>{const u=@getByIdDirectPrivate(i,\"state\");@assert(u===\"writable\"||u===\"erroring\"),@putByIdDirectPrivate(d,\"started\",1),@writableStreamDefaultControllerAdvanceQueueIfNeeded(d)},(u)=>{const v=@getByIdDirectPrivate(i,\"state\");@assert(v===\"writable\"||v===\"erroring\"),@putByIdDirectPrivate(d,\"started\",1),@writableStreamDealWithRejection(i,u)})})\n";

// setUpWritableStreamDefaultControllerFromUnderlyingSink
const JSC::ConstructAbility s_writableStreamInternalsSetUpWritableStreamDefaultControllerFromUnderlyingSinkCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsSetUpWritableStreamDefaultControllerFromUnderlyingSinkCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsSetUpWritableStreamDefaultControllerFromUnderlyingSinkCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsSetUpWritableStreamDefaultControllerFromUnderlyingSinkCodeLength = 573;
static const JSC::Intrinsic s_writableStreamInternalsSetUpWritableStreamDefaultControllerFromUnderlyingSinkCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsSetUpWritableStreamDefaultControllerFromUnderlyingSinkCode = "(function (_,p,f,j,q){\"use strict\";const v=new @WritableStreamDefaultController;let x=()=>{},B=()=>{return @Promise.@resolve()},C=()=>{return @Promise.@resolve()},E=()=>{return @Promise.@resolve()};if(\"start\"in f){const F=f[\"start\"];x=()=>@promiseInvokeOrNoopMethodNoCatch(p,F,[v])}if(\"write\"in f){const F=f[\"write\"];B=(G)=>@promiseInvokeOrNoopMethod(p,F,[G,v])}if(\"close\"in f){const F=f[\"close\"];C=()=>@promiseInvokeOrNoopMethod(p,F,[])}if(\"abort\"in f){const F=f[\"abort\"];E=(G)=>@promiseInvokeOrNoopMethod(p,F,[G])}@setUpWritableStreamDefaultController(_,v,x,B,C,E,j,q)})\n";

// writableStreamDefaultControllerAdvanceQueueIfNeeded
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultControllerAdvanceQueueIfNeededCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultControllerAdvanceQueueIfNeededCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultControllerAdvanceQueueIfNeededCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultControllerAdvanceQueueIfNeededCodeLength = 582;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultControllerAdvanceQueueIfNeededCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultControllerAdvanceQueueIfNeededCode = "(function (d){\"use strict\";const f=@getByIdDirectPrivate(d,\"stream\");if(@getByIdDirectPrivate(d,\"started\")!==1)return;if(@assert(f!==@undefined),@getByIdDirectPrivate(f,\"inFlightWriteRequest\")!==@undefined)return;const P=@getByIdDirectPrivate(f,\"state\");if(@assert(P!==\"closed\"||P!==\"errored\"),P===\"erroring\"){@writableStreamFinishErroring(f);return}const _=@getByIdDirectPrivate(d,\"queue\");if(_.content\?.isEmpty()\?\?!1)return;const b=@peekQueueValue(_);if(b===@isCloseSentinel)@writableStreamDefaultControllerProcessClose(d);else @writableStreamDefaultControllerProcessWrite(d,b)})\n";

// isCloseSentinel
const JSC::ConstructAbility s_writableStreamInternalsIsCloseSentinelCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsIsCloseSentinelCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsIsCloseSentinelCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsIsCloseSentinelCodeLength = 29;
static const JSC::Intrinsic s_writableStreamInternalsIsCloseSentinelCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsIsCloseSentinelCode = "(function (){\"use strict\";})\n";

// writableStreamDefaultControllerClearAlgorithms
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultControllerClearAlgorithmsCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultControllerClearAlgorithmsCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultControllerClearAlgorithmsCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultControllerClearAlgorithmsCodeLength = 248;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultControllerClearAlgorithmsCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultControllerClearAlgorithmsCode = "(function (d){\"use strict\";@putByIdDirectPrivate(d,\"writeAlgorithm\",@undefined),@putByIdDirectPrivate(d,\"closeAlgorithm\",@undefined),@putByIdDirectPrivate(d,\"abortAlgorithm\",@undefined),@putByIdDirectPrivate(d,\"strategySizeAlgorithm\",@undefined)})\n";

// writableStreamDefaultControllerClose
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultControllerCloseCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultControllerCloseCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultControllerCloseCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultControllerCloseCodeLength = 160;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultControllerCloseCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultControllerCloseCode = "(function (u){\"use strict\";@enqueueValueWithSize(@getByIdDirectPrivate(u,\"queue\"),@isCloseSentinel,0),@writableStreamDefaultControllerAdvanceQueueIfNeeded(u)})\n";

// writableStreamDefaultControllerError
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultControllerErrorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultControllerErrorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultControllerErrorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultControllerErrorCodeLength = 237;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultControllerErrorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultControllerErrorCode = "(function (d,i){\"use strict\";const u=@getByIdDirectPrivate(d,\"stream\");@assert(u!==@undefined),@assert(@getByIdDirectPrivate(u,\"state\")===\"writable\"),@writableStreamDefaultControllerClearAlgorithms(d),@writableStreamStartErroring(u,i)})\n";

// writableStreamDefaultControllerErrorIfNeeded
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultControllerErrorIfNeededCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultControllerErrorIfNeededCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultControllerErrorIfNeededCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultControllerErrorIfNeededCodeLength = 165;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultControllerErrorIfNeededCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultControllerErrorIfNeededCode = "(function (d,a){\"use strict\";const p=@getByIdDirectPrivate(d,\"stream\");if(@getByIdDirectPrivate(p,\"state\")===\"writable\")@writableStreamDefaultControllerError(d,a)})\n";

// writableStreamDefaultControllerGetBackpressure
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultControllerGetBackpressureCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultControllerGetBackpressureCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultControllerGetBackpressureCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultControllerGetBackpressureCodeLength = 89;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultControllerGetBackpressureCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultControllerGetBackpressureCode = "(function (a){\"use strict\";return @writableStreamDefaultControllerGetDesiredSize(a)<=0})\n";

// writableStreamDefaultControllerGetChunkSize
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultControllerGetChunkSizeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultControllerGetChunkSizeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultControllerGetChunkSizeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultControllerGetChunkSizeCodeLength = 181;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultControllerGetChunkSizeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultControllerGetChunkSizeCode = "(function (d,i){\"use strict\";try{return @getByIdDirectPrivate(d,\"strategySizeAlgorithm\").@call(@undefined,i)}catch(A){return @writableStreamDefaultControllerErrorIfNeeded(d,A),1}})\n";

// writableStreamDefaultControllerGetDesiredSize
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultControllerGetDesiredSizeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultControllerGetDesiredSizeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultControllerGetDesiredSizeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultControllerGetDesiredSizeCodeLength = 113;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultControllerGetDesiredSizeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultControllerGetDesiredSizeCode = "(function (d){\"use strict\";return @getByIdDirectPrivate(d,\"strategyHWM\")-@getByIdDirectPrivate(d,\"queue\").size})\n";

// writableStreamDefaultControllerProcessClose
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultControllerProcessCloseCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultControllerProcessCloseCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultControllerProcessCloseCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultControllerProcessCloseCodeLength = 441;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultControllerProcessCloseCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultControllerProcessCloseCode = "(function (u){\"use strict\";const d=@getByIdDirectPrivate(u,\"stream\");@writableStreamMarkCloseRequestInFlight(d),@dequeueValue(@getByIdDirectPrivate(u,\"queue\")),@assert(@getByIdDirectPrivate(u,\"queue\").content\?.isEmpty());const g=@getByIdDirectPrivate(u,\"closeAlgorithm\").@call();@writableStreamDefaultControllerClearAlgorithms(u),g.@then(()=>{@writableStreamFinishInFlightClose(d)},(b)=>{@writableStreamFinishInFlightCloseWithError(d,b)})})\n";

// writableStreamDefaultControllerProcessWrite
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultControllerProcessWriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultControllerProcessWriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultControllerProcessWriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultControllerProcessWriteCodeLength = 734;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultControllerProcessWriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultControllerProcessWriteCode = "(function (_,d){\"use strict\";const f=@getByIdDirectPrivate(_,\"stream\");@writableStreamMarkFirstWriteRequestInFlight(f),@getByIdDirectPrivate(_,\"writeAlgorithm\").@call(@undefined,d).@then(()=>{@writableStreamFinishInFlightWrite(f);const v=@getByIdDirectPrivate(f,\"state\");if(@assert(v===\"writable\"||v===\"erroring\"),@dequeueValue(@getByIdDirectPrivate(_,\"queue\")),!@writableStreamCloseQueuedOrInFlight(f)&&v===\"writable\"){const F=@writableStreamDefaultControllerGetBackpressure(_);@writableStreamUpdateBackpressure(f,F)}@writableStreamDefaultControllerAdvanceQueueIfNeeded(_)},(v)=>{if(@getByIdDirectPrivate(f,\"state\")===\"writable\")@writableStreamDefaultControllerClearAlgorithms(_);@writableStreamFinishInFlightWriteWithError(f,v)})})\n";

// writableStreamDefaultControllerWrite
const JSC::ConstructAbility s_writableStreamInternalsWritableStreamDefaultControllerWriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamInternalsWritableStreamDefaultControllerWriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamInternalsWritableStreamDefaultControllerWriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamInternalsWritableStreamDefaultControllerWriteCodeLength = 450;
static const JSC::Intrinsic s_writableStreamInternalsWritableStreamDefaultControllerWriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamInternalsWritableStreamDefaultControllerWriteCode = "(function (_,d,y){\"use strict\";try{@enqueueValueWithSize(@getByIdDirectPrivate(_,\"queue\"),d,y);const f=@getByIdDirectPrivate(_,\"stream\"),g=@getByIdDirectPrivate(f,\"state\");if(!@writableStreamCloseQueuedOrInFlight(f)&&g===\"writable\"){const j=@writableStreamDefaultControllerGetBackpressure(_);@writableStreamUpdateBackpressure(f,j)}@writableStreamDefaultControllerAdvanceQueueIfNeeded(_)}catch(f){@writableStreamDefaultControllerErrorIfNeeded(_,f)}})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().writableStreamInternalsBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().writableStreamInternalsBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_WRITABLESTREAMINTERNALS_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* TransformStreamInternals.ts */
// isTransformStream
const JSC::ConstructAbility s_transformStreamInternalsIsTransformStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsIsTransformStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsIsTransformStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsIsTransformStreamCodeLength = 88;
static const JSC::Intrinsic s_transformStreamInternalsIsTransformStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsIsTransformStreamCode = "(function (n){\"use strict\";return @isObject(n)&&!!@getByIdDirectPrivate(n,\"readable\")})\n";

// isTransformStreamDefaultController
const JSC::ConstructAbility s_transformStreamInternalsIsTransformStreamDefaultControllerCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsIsTransformStreamDefaultControllerCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsIsTransformStreamDefaultControllerCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsIsTransformStreamDefaultControllerCodeLength = 98;
static const JSC::Intrinsic s_transformStreamInternalsIsTransformStreamDefaultControllerCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsIsTransformStreamDefaultControllerCode = "(function (a){\"use strict\";return @isObject(a)&&!!@getByIdDirectPrivate(a,\"transformAlgorithm\")})\n";

// createTransformStream
const JSC::ConstructAbility s_transformStreamInternalsCreateTransformStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsCreateTransformStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsCreateTransformStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsCreateTransformStreamCodeLength = 513;
static const JSC::Intrinsic s_transformStreamInternalsCreateTransformStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsCreateTransformStreamCode = "(function (c,_,j,q,v,x,B){\"use strict\";if(q===@undefined)q=1;if(v===@undefined)v=()=>1;if(x===@undefined)x=0;if(B===@undefined)B=()=>1;@assert(q>=0),@assert(x>=0);const D={};@putByIdDirectPrivate(D,\"TransformStream\",!0);const E=new @TransformStream(D),F=@newPromiseCapability(@Promise);@initializeTransformStream(E,F.@promise,q,v,x,B);const G=new @TransformStreamDefaultController;return @setUpTransformStreamDefaultController(E,G,_,j),c().@then(()=>{F.@resolve.@call()},(I)=>{F.@reject.@call(@undefined,I)}),E})\n";

// initializeTransformStream
const JSC::ConstructAbility s_transformStreamInternalsInitializeTransformStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsInitializeTransformStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsInitializeTransformStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsInitializeTransformStreamCodeLength = 1015;
static const JSC::Intrinsic s_transformStreamInternalsInitializeTransformStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsInitializeTransformStreamCode = "(function (D,_,f,j,q,v){\"use strict\";const x=()=>{return _},B=(N)=>{return @transformStreamDefaultSinkWriteAlgorithm(D,N)},C=(N)=>{return @transformStreamDefaultSinkAbortAlgorithm(D,N)},E=()=>{return @transformStreamDefaultSinkCloseAlgorithm(D)},F=@createWritableStream(x,B,E,C,f,j),G=()=>{return @transformStreamDefaultSourcePullAlgorithm(D)},I=(N)=>{return @transformStreamErrorWritableAndUnblockWrite(D,N),@Promise.@resolve()},J={};@putByIdDirectPrivate(J,\"start\",x),@putByIdDirectPrivate(J,\"pull\",G),@putByIdDirectPrivate(J,\"cancel\",I);const K={};@putByIdDirectPrivate(K,\"size\",v),@putByIdDirectPrivate(K,\"highWaterMark\",q);const L=new @ReadableStream(J,K);@putByIdDirectPrivate(D,\"writable\",F),@putByIdDirectPrivate(D,\"internalWritable\",@getInternalWritableStream(F)),@putByIdDirectPrivate(D,\"readable\",L),@putByIdDirectPrivate(D,\"backpressure\",@undefined),@putByIdDirectPrivate(D,\"backpressureChangePromise\",@undefined),@transformStreamSetBackpressure(D,!0),@putByIdDirectPrivate(D,\"controller\",@undefined)})\n";

// transformStreamError
const JSC::ConstructAbility s_transformStreamInternalsTransformStreamErrorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsTransformStreamErrorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsTransformStreamErrorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsTransformStreamErrorCodeLength = 222;
static const JSC::Intrinsic s_transformStreamInternalsTransformStreamErrorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsTransformStreamErrorCode = "(function (i,n){\"use strict\";const S=@getByIdDirectPrivate(i,\"readable\"),c=@getByIdDirectPrivate(S,\"readableStreamController\");@readableStreamDefaultControllerError(c,n),@transformStreamErrorWritableAndUnblockWrite(i,n)})\n";

// transformStreamErrorWritableAndUnblockWrite
const JSC::ConstructAbility s_transformStreamInternalsTransformStreamErrorWritableAndUnblockWriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsTransformStreamErrorWritableAndUnblockWriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsTransformStreamErrorWritableAndUnblockWriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsTransformStreamErrorWritableAndUnblockWriteCodeLength = 339;
static const JSC::Intrinsic s_transformStreamInternalsTransformStreamErrorWritableAndUnblockWriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsTransformStreamErrorWritableAndUnblockWriteCode = "(function (n,o){\"use strict\";@transformStreamDefaultControllerClearAlgorithms(@getByIdDirectPrivate(n,\"controller\"));const c=@getByIdDirectPrivate(n,\"internalWritable\");if(@writableStreamDefaultControllerErrorIfNeeded(@getByIdDirectPrivate(c,\"controller\"),o),@getByIdDirectPrivate(n,\"backpressure\"))@transformStreamSetBackpressure(n,!1)})\n";

// transformStreamSetBackpressure
const JSC::ConstructAbility s_transformStreamInternalsTransformStreamSetBackpressureCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsTransformStreamSetBackpressureCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsTransformStreamSetBackpressureCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsTransformStreamSetBackpressureCodeLength = 309;
static const JSC::Intrinsic s_transformStreamInternalsTransformStreamSetBackpressureCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsTransformStreamSetBackpressureCode = "(function (l,_){\"use strict\";@assert(@getByIdDirectPrivate(l,\"backpressure\")!==_);const d=@getByIdDirectPrivate(l,\"backpressureChangePromise\");if(d!==@undefined)d.@resolve.@call();@putByIdDirectPrivate(l,\"backpressureChangePromise\",@newPromiseCapability(@Promise)),@putByIdDirectPrivate(l,\"backpressure\",_)})\n";

// setUpTransformStreamDefaultController
const JSC::ConstructAbility s_transformStreamInternalsSetUpTransformStreamDefaultControllerCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsSetUpTransformStreamDefaultControllerCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsSetUpTransformStreamDefaultControllerCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsSetUpTransformStreamDefaultControllerCodeLength = 294;
static const JSC::Intrinsic s_transformStreamInternalsSetUpTransformStreamDefaultControllerCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsSetUpTransformStreamDefaultControllerCode = "(function (_,b,d,j){\"use strict\";@assert(@isTransformStream(_)),@assert(@getByIdDirectPrivate(_,\"controller\")===@undefined),@putByIdDirectPrivate(b,\"stream\",_),@putByIdDirectPrivate(_,\"controller\",b),@putByIdDirectPrivate(b,\"transformAlgorithm\",d),@putByIdDirectPrivate(b,\"flushAlgorithm\",j)})\n";

// setUpTransformStreamDefaultControllerFromTransformer
const JSC::ConstructAbility s_transformStreamInternalsSetUpTransformStreamDefaultControllerFromTransformerCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsSetUpTransformStreamDefaultControllerFromTransformerCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsSetUpTransformStreamDefaultControllerFromTransformerCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsSetUpTransformStreamDefaultControllerFromTransformerCodeLength = 449;
static const JSC::Intrinsic s_transformStreamInternalsSetUpTransformStreamDefaultControllerFromTransformerCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsSetUpTransformStreamDefaultControllerFromTransformerCode = "(function (_,d,p){\"use strict\";const b=new @TransformStreamDefaultController;let j=(v)=>{try{@transformStreamDefaultControllerEnqueue(b,v)}catch(w){return @Promise.@reject(w)}return @Promise.@resolve()},q=()=>{return @Promise.@resolve()};if(\"transform\"in p)j=(v)=>{return @promiseInvokeOrNoopMethod(d,p[\"transform\"],[v,b])};if(\"flush\"in p)q=()=>{return @promiseInvokeOrNoopMethod(d,p[\"flush\"],[b])};@setUpTransformStreamDefaultController(_,b,j,q)})\n";

// transformStreamDefaultControllerClearAlgorithms
const JSC::ConstructAbility s_transformStreamInternalsTransformStreamDefaultControllerClearAlgorithmsCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsTransformStreamDefaultControllerClearAlgorithmsCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsTransformStreamDefaultControllerClearAlgorithmsCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsTransformStreamDefaultControllerClearAlgorithmsCodeLength = 131;
static const JSC::Intrinsic s_transformStreamInternalsTransformStreamDefaultControllerClearAlgorithmsCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsTransformStreamDefaultControllerClearAlgorithmsCode = "(function (b){\"use strict\";@putByIdDirectPrivate(b,\"transformAlgorithm\",!0),@putByIdDirectPrivate(b,\"flushAlgorithm\",@undefined)})\n";

// transformStreamDefaultControllerEnqueue
const JSC::ConstructAbility s_transformStreamInternalsTransformStreamDefaultControllerEnqueueCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsTransformStreamDefaultControllerEnqueueCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsTransformStreamDefaultControllerEnqueueCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsTransformStreamDefaultControllerEnqueueCodeLength = 622;
static const JSC::Intrinsic s_transformStreamInternalsTransformStreamDefaultControllerEnqueueCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsTransformStreamDefaultControllerEnqueueCode = "(function (i,f){\"use strict\";const B=@getByIdDirectPrivate(i,\"stream\"),_=@getByIdDirectPrivate(B,\"readable\"),g=@getByIdDirectPrivate(_,\"readableStreamController\");if(@assert(g!==@undefined),!@readableStreamDefaultControllerCanCloseOrEnqueue(g))@throwTypeError(\"TransformStream.readable cannot close or enqueue\");try{@readableStreamDefaultControllerEnqueue(g,f)}catch(q){throw @transformStreamErrorWritableAndUnblockWrite(B,q),@getByIdDirectPrivate(_,\"storedError\")}const j=!@readableStreamDefaultControllerShouldCallPull(g);if(j!==@getByIdDirectPrivate(B,\"backpressure\"))@assert(j),@transformStreamSetBackpressure(B,!0)})\n";

// transformStreamDefaultControllerError
const JSC::ConstructAbility s_transformStreamInternalsTransformStreamDefaultControllerErrorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsTransformStreamDefaultControllerErrorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsTransformStreamDefaultControllerErrorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsTransformStreamDefaultControllerErrorCodeLength = 90;
static const JSC::Intrinsic s_transformStreamInternalsTransformStreamDefaultControllerErrorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsTransformStreamDefaultControllerErrorCode = "(function (a,g){\"use strict\";@transformStreamError(@getByIdDirectPrivate(a,\"stream\"),g)})\n";

// transformStreamDefaultControllerPerformTransform
const JSC::ConstructAbility s_transformStreamInternalsTransformStreamDefaultControllerPerformTransformCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsTransformStreamDefaultControllerPerformTransformCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsTransformStreamDefaultControllerPerformTransformCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsTransformStreamDefaultControllerPerformTransformCodeLength = 277;
static const JSC::Intrinsic s_transformStreamInternalsTransformStreamDefaultControllerPerformTransformCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsTransformStreamDefaultControllerPerformTransformCode = "(function (_,d){\"use strict\";const f=@newPromiseCapability(@Promise);return @getByIdDirectPrivate(_,\"transformAlgorithm\").@call(@undefined,d).@then(()=>{f.@resolve()},(j)=>{@transformStreamError(@getByIdDirectPrivate(_,\"stream\"),j),f.@reject.@call(@undefined,j)}),f.@promise})\n";

// transformStreamDefaultControllerTerminate
const JSC::ConstructAbility s_transformStreamInternalsTransformStreamDefaultControllerTerminateCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsTransformStreamDefaultControllerTerminateCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsTransformStreamDefaultControllerTerminateCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsTransformStreamDefaultControllerTerminateCodeLength = 367;
static const JSC::Intrinsic s_transformStreamInternalsTransformStreamDefaultControllerTerminateCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsTransformStreamDefaultControllerTerminateCode = "(function (i){\"use strict\";const f=@getByIdDirectPrivate(i,\"stream\"),g=@getByIdDirectPrivate(f,\"readable\"),h=@getByIdDirectPrivate(g,\"readableStreamController\");if(@readableStreamDefaultControllerCanCloseOrEnqueue(h))@readableStreamDefaultControllerClose(h);const j=@makeTypeError(\"the stream has been terminated\");@transformStreamErrorWritableAndUnblockWrite(f,j)})\n";

// transformStreamDefaultSinkWriteAlgorithm
const JSC::ConstructAbility s_transformStreamInternalsTransformStreamDefaultSinkWriteAlgorithmCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsTransformStreamDefaultSinkWriteAlgorithmCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsTransformStreamDefaultSinkWriteAlgorithmCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsTransformStreamDefaultSinkWriteAlgorithmCodeLength = 764;
static const JSC::Intrinsic s_transformStreamInternalsTransformStreamDefaultSinkWriteAlgorithmCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsTransformStreamDefaultSinkWriteAlgorithmCode = "(function (_,d){\"use strict\";const v=@getByIdDirectPrivate(_,\"internalWritable\");@assert(@getByIdDirectPrivate(v,\"state\")===\"writable\");const S=@getByIdDirectPrivate(_,\"controller\");if(@getByIdDirectPrivate(_,\"backpressure\")){const f=@newPromiseCapability(@Promise),j=@getByIdDirectPrivate(_,\"backpressureChangePromise\");return @assert(j!==@undefined),j.@promise.@then(()=>{const q=@getByIdDirectPrivate(v,\"state\");if(q===\"erroring\"){f.@reject.@call(@undefined,@getByIdDirectPrivate(v,\"storedError\"));return}@assert(q===\"writable\"),@transformStreamDefaultControllerPerformTransform(S,d).@then(()=>{f.@resolve()},(x)=>{f.@reject.@call(@undefined,x)})},(q)=>{f.@reject.@call(@undefined,q)}),f.@promise}return @transformStreamDefaultControllerPerformTransform(S,d)})\n";

// transformStreamDefaultSinkAbortAlgorithm
const JSC::ConstructAbility s_transformStreamInternalsTransformStreamDefaultSinkAbortAlgorithmCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsTransformStreamDefaultSinkAbortAlgorithmCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsTransformStreamDefaultSinkAbortAlgorithmCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsTransformStreamDefaultSinkAbortAlgorithmCodeLength = 85;
static const JSC::Intrinsic s_transformStreamInternalsTransformStreamDefaultSinkAbortAlgorithmCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsTransformStreamDefaultSinkAbortAlgorithmCode = "(function (c,d){\"use strict\";return @transformStreamError(c,d),@Promise.@resolve()})\n";

// transformStreamDefaultSinkCloseAlgorithm
const JSC::ConstructAbility s_transformStreamInternalsTransformStreamDefaultSinkCloseAlgorithmCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsTransformStreamDefaultSinkCloseAlgorithmCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsTransformStreamDefaultSinkCloseAlgorithmCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsTransformStreamDefaultSinkCloseAlgorithmCodeLength = 789;
static const JSC::Intrinsic s_transformStreamInternalsTransformStreamDefaultSinkCloseAlgorithmCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsTransformStreamDefaultSinkCloseAlgorithmCode = "(function (_){\"use strict\";const I=@getByIdDirectPrivate(_,\"readable\"),X=@getByIdDirectPrivate(_,\"controller\"),j=@getByIdDirectPrivate(I,\"readableStreamController\"),k=@getByIdDirectPrivate(X,\"flushAlgorithm\");@assert(k!==@undefined);const q=@getByIdDirectPrivate(X,\"flushAlgorithm\").@call();@transformStreamDefaultControllerClearAlgorithms(X);const v=@newPromiseCapability(@Promise);return q.@then(()=>{if(@getByIdDirectPrivate(I,\"state\")===@streamErrored){v.@reject.@call(@undefined,@getByIdDirectPrivate(I,\"storedError\"));return}if(@readableStreamDefaultControllerCanCloseOrEnqueue(j))@readableStreamDefaultControllerClose(j);v.@resolve()},(w)=>{@transformStreamError(@getByIdDirectPrivate(X,\"stream\"),w),v.@reject.@call(@undefined,@getByIdDirectPrivate(I,\"storedError\"))}),v.@promise})\n";

// transformStreamDefaultSourcePullAlgorithm
const JSC::ConstructAbility s_transformStreamInternalsTransformStreamDefaultSourcePullAlgorithmCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInternalsTransformStreamDefaultSourcePullAlgorithmCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInternalsTransformStreamDefaultSourcePullAlgorithmCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInternalsTransformStreamDefaultSourcePullAlgorithmCodeLength = 260;
static const JSC::Intrinsic s_transformStreamInternalsTransformStreamDefaultSourcePullAlgorithmCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInternalsTransformStreamDefaultSourcePullAlgorithmCode = "(function (n){\"use strict\";return @assert(@getByIdDirectPrivate(n,\"backpressure\")),@assert(@getByIdDirectPrivate(n,\"backpressureChangePromise\")!==@undefined),@transformStreamSetBackpressure(n,!1),@getByIdDirectPrivate(n,\"backpressureChangePromise\").@promise})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().transformStreamInternalsBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().transformStreamInternalsBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_TRANSFORMSTREAMINTERNALS_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ProcessObjectInternals.ts */
// binding
const JSC::ConstructAbility s_processObjectInternalsBindingCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_processObjectInternalsBindingCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_processObjectInternalsBindingCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_processObjectInternalsBindingCodeLength = 473;
static const JSC::Intrinsic s_processObjectInternalsBindingCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_processObjectInternalsBindingCode = "(function (r){\"use strict\";if(r!==\"constants\")@throwTypeError(\"process.binding() is not supported in Bun. If that breaks something, please file an issue and include a reproducible code sample.\");var l=globalThis.Symbol.for(\"process.bindings.constants\"),p=globalThis[l];if(!p){const{constants:u}=globalThis[globalThis.Symbol.for(\"Bun.lazy\")](\"createImportMeta\",\"node:process\").require(\"node:fs\");p={fs:u,zlib:{},crypto:{},os:@Bun._Os().constants},globalThis[l]=p}return p})\n";

// getStdioWriteStream
const JSC::ConstructAbility s_processObjectInternalsGetStdioWriteStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_processObjectInternalsGetStdioWriteStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_processObjectInternalsGetStdioWriteStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_processObjectInternalsGetStdioWriteStreamCodeLength = 4250;
static const JSC::Intrinsic s_processObjectInternalsGetStdioWriteStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_processObjectInternalsGetStdioWriteStreamCode = "(function (N,j){\"use strict\";var z={path:\"node:process\",require:j},B=(M)=>z.require(M);function G(M){var{Duplex:O,eos:Q,destroy:U}=B(\"node:stream\"),V=class X extends O{#$;#N;#j=!0;#z=!0;#B;#G;#H;#J;#K;#L;get isTTY(){return this.#L\?\?=B(\"node:tty\").isatty(M)}get fd(){return M}constructor(Z){super({readable:!0,writable:!0});this.#B=`/dev/fd/${Z}`}#M(Z){const P=this.#G;if(this.#G=null,P)P(Z);else if(Z)this.destroy(Z);else if(!this.#j&&!this.#z)this.destroy()}_destroy(Z,P){if(!Z&&this.#G!==null){var Y=class T extends Error{code;name;constructor(A=\"The operation was aborted\",x=void 0){if(x!==void 0&&typeof x!==\"object\")throw new Error(`Invalid AbortError options:\\n\\n${JSON.stringify(x,null,2)}`);super(A,x);this.code=\"ABORT_ERR\",this.name=\"AbortError\"}};Z=new Y}if(this.#H=null,this.#J=null,this.#G===null)P(Z);else{if(this.#G=P,this.#$)U(this.#$,Z);if(this.#N)U(this.#N,Z)}}_write(Z,P,Y){if(!this.#$){var{createWriteStream:T}=B(\"node:fs\"),A=this.#$=T(this.#B);A.on(\"finish\",()=>{if(this.#J){const x=this.#J;this.#J=null,x()}}),A.on(\"drain\",()=>{if(this.#H){const x=this.#H;this.#H=null,x()}}),Q(A,(x)=>{if(this.#z=!1,x)U(A,x);this.#M(x)})}if(A.write(Z,P))Y();else this.#H=Y}_final(Z){this.#$&&this.#$.end(),this.#J=Z}#O(){var{createReadStream:Z}=B(\"node:fs\"),P=this.#N=Z(this.#B);return P.on(\"readable\",()=>{if(this.#K){const Y=this.#K;this.#K=null,Y()}else this.read()}),P.on(\"end\",()=>{this.push(null)}),Q(P,(Y)=>{if(this.#j=!1,Y)U(P,Y);this.#M(Y)}),P}_read(){var Z=this.#N;if(!Z)Z=this.#O();while(!0){const P=Z.read();if(P===null||!this.push(P))return}}};return new V(M)}var{EventEmitter:H}=B(\"node:events\");function J(M){if(!M)return!0;var O=M.toLowerCase();return O===\"utf8\"||O===\"utf-8\"||O===\"buffer\"||O===\"binary\"}var K,L=class M extends H{#$;#N;#j;#z;bytesWritten=0;setDefaultEncoding(O){if(this.#N||!J(O))return this.#H(),this.#N.setDefaultEncoding(O)}#B(){switch(this.#$){case 1:{var O=@Bun.stdout.writer({highWaterMark:0});return O.unref(),O}case 2:{var O=@Bun.stderr.writer({highWaterMark:0});return O.unref(),O}default:throw new Error(\"Unsupported writer\")}}#G(){return this.#j\?\?=this.#B()}constructor(O){super();this.#$=O}get fd(){return this.#$}get isTTY(){return this.#z\?\?=B(\"node:tty\").isatty(this.#$)}cursorTo(O,Q,U){return(K\?\?=B(\"readline\")).cursorTo(this,O,Q,U)}moveCursor(O,Q,U){return(K\?\?=B(\"readline\")).moveCursor(this,O,Q,U)}clearLine(O,Q){return(K\?\?=B(\"readline\")).clearLine(this,O,Q)}clearScreenDown(O){return(K\?\?=B(\"readline\")).clearScreenDown(this,O)}ref(){this.#G().ref()}unref(){this.#G().unref()}on(O,Q){if(O===\"close\"||O===\"finish\")return this.#H(),this.#N.on(O,Q);if(O===\"drain\")return super.on(\"drain\",Q);if(O===\"error\")return super.on(\"error\",Q);return super.on(O,Q)}get _writableState(){return this.#H(),this.#N._writableState}get _readableState(){return this.#H(),this.#N._readableState}pipe(O){return this.#H(),this.#N.pipe(O)}unpipe(O){return this.#H(),this.#N.unpipe(O)}#H(){if(this.#N)return;this.#N=G(this.#$);const O=this.eventNames();for(let Q of O)this.#N.on(Q,(...U)=>{this.emit(Q,...U)})}#J(O){var Q=this.#G();const U=Q.write(O);this.bytesWritten+=U;const V=Q.flush(!1);return!!(U||V)}#K(O,Q){if(!J(Q))return this.#H(),this.#N.write(O,Q);return this.#J(O)}#L(O,Q){if(Q)this.emit(\"error\",Q);try{O(Q\?Q:null)}catch(U){this.emit(\"error\",U)}}#M(O,Q,U){if(!J(Q))return this.#H(),this.#N.write(O,Q,U);var V=this.#G();const X=V.write(O),Z=V.flush(!0);if(Z\?.then)return Z.then(()=>{this.#L(U),this.emit(\"drain\")},(P)=>this.#L(U,P)),!1;return queueMicrotask(()=>{this.#L(U)}),!!(X||Z)}write(O,Q,U){const V=this._write(O,Q,U);if(V)this.emit(\"drain\");return V}get hasColors(){return @Bun.tty[this.#$].hasColors}_write(O,Q,U){var V=this.#N;if(V)return V.write(O,Q,U);switch(arguments.length){case 0:{var X=new Error(\"Invalid arguments\");throw X.code=\"ERR_INVALID_ARG_TYPE\",X}case 1:return this.#J(O);case 2:if(typeof Q===\"function\")return this.#M(O,\"\",Q);else if(typeof Q===\"string\")return this.#K(O,Q);default:{if(typeof Q!==\"undefined\"&&typeof Q!==\"string\"||typeof U!==\"undefined\"&&typeof U!==\"function\"){var X=new Error(\"Invalid arguments\");throw X.code=\"ERR_INVALID_ARG_TYPE\",X}if(typeof U===\"undefined\")return this.#K(O,Q);return this.#M(O,Q,U)}}}destroy(){return this}end(){return this}};return new L(N)})\n";

// getStdinStream
const JSC::ConstructAbility s_processObjectInternalsGetStdinStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_processObjectInternalsGetStdinStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_processObjectInternalsGetStdinStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_processObjectInternalsGetStdinStreamCodeLength = 1799;
static const JSC::Intrinsic s_processObjectInternalsGetStdinStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_processObjectInternalsGetStdinStreamCode = "(function (j,z,G){\"use strict\";var H={path:\"node:process\",require:z},J=(P)=>H.require(P),{Duplex:K,eos:L,destroy:M}=J(\"node:stream\"),N=class P extends K{#$;#j;#z;#G=!0;#H=!1;#J=!0;#K;#L;#M;get isTTY(){return J(\"tty\").isatty(j)}get fd(){return j}constructor(){super({readable:!0,writable:!0})}#N(Q){const T=this.#L;if(this.#L=null,T)T(Q);else if(Q)this.destroy(Q);else if(!this.#G&&!this.#J)this.destroy()}_destroy(Q,T){if(!Q&&this.#L!==null){var U=class V extends Error{constructor(X=\"The operation was aborted\",Y=void 0){if(Y!==void 0&&typeof Y!==\"object\")throw new Error(`Invalid AbortError options:\\n\\n${JSON.stringify(Y,null,2)}`);super(X,Y);this.code=\"ABORT_ERR\",this.name=\"AbortError\"}};Q=new U}if(this.#L===null)T(Q);else if(this.#L=T,this.#z)M(this.#z,Q)}setRawMode(Q){}on(Q,T){if(Q===\"readable\")this.ref(),this.#H=!0;return super.on(Q,T)}pause(){return this.unref(),super.pause()}resume(){return this.ref(),super.resume()}ref(){this.#$\?\?=G.stdin.stream().getReader(),this.#j\?\?=setInterval(()=>{},1<<30)}unref(){if(this.#j)clearInterval(this.#j),this.#j=null}async#P(){try{var Q,T;const U=this.#$.readMany();if(!U\?.then)({done:Q,value:T}=U);else({done:Q,value:T}=await U);if(!Q){this.push(T[0]);const V=T.length;for(let X=1;X<V;X++)this.push(T[X])}else this.push(null),this.pause(),this.#G=!1,this.#N()}catch(U){this.#G=!1,this.#N(U)}}_read(Q){if(this.#H)this.unref(),this.#H=!1;this.#P()}#Q(){var{createWriteStream:Q}=J(\"node:fs\"),T=this.#z=Q(\"/dev/fd/0\");return T.on(\"finish\",()=>{if(this.#K){const U=this.#K;this.#K=null,U()}}),T.on(\"drain\",()=>{if(this.#M){const U=this.#M;this.#M=null,U()}}),L(T,(U)=>{if(this.#J=!1,U)M(T,U);this.#N(U)}),T}_write(Q,T,U){var V=this.#z;if(!V)V=this.#Q();if(V.write(Q,T))U();else this.#M=U}_final(Q){this.#z.end(),this.#K=(...T)=>Q(...T)}};return new N})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().processObjectInternalsBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().processObjectInternalsBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_PROCESSOBJECTINTERNALS_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* TransformStream.ts */
// initializeTransformStream
const JSC::ConstructAbility s_transformStreamInitializeTransformStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamInitializeTransformStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamInitializeTransformStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamInitializeTransformStreamCodeLength = 1334;
static const JSC::Intrinsic s_transformStreamInitializeTransformStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamInitializeTransformStreamCode = "(function (){\"use strict\";let _=arguments[0];if(@isObject(_)&&@getByIdDirectPrivate(_,\"TransformStream\"))return this;let u=arguments[1],j=arguments[2];if(_===@undefined)_=null;if(j===@undefined)j={};if(u===@undefined)u={};let q={};if(_!==null){if(\"start\"in _){if(q[\"start\"]=_[\"start\"],typeof q[\"start\"]!==\"function\")@throwTypeError(\"transformer.start should be a function\")}if(\"transform\"in _){if(q[\"transform\"]=_[\"transform\"],typeof q[\"transform\"]!==\"function\")@throwTypeError(\"transformer.transform should be a function\")}if(\"flush\"in _){if(q[\"flush\"]=_[\"flush\"],typeof q[\"flush\"]!==\"function\")@throwTypeError(\"transformer.flush should be a function\")}if(\"readableType\"in _)@throwRangeError(\"TransformStream transformer has a readableType\");if(\"writableType\"in _)@throwRangeError(\"TransformStream transformer has a writableType\")}const v=@extractHighWaterMark(j,0),x=@extractSizeAlgorithm(j),B=@extractHighWaterMark(u,1),E=@extractSizeAlgorithm(u),F=@newPromiseCapability(@Promise);if(@initializeTransformStream(this,F.@promise,B,E,v,x),@setUpTransformStreamDefaultControllerFromTransformer(this,_,q),(\"start\"in q)){const G=@getByIdDirectPrivate(this,\"controller\");(()=>@promiseInvokeOrNoopMethodNoCatch(_,q[\"start\"],[G]))().@then(()=>{F.@resolve.@call()},(J)=>{F.@reject.@call(@undefined,J)})}else F.@resolve.@call();return this})\n";

// readable
const JSC::ConstructAbility s_transformStreamReadableCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamReadableCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamReadableCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamReadableCodeLength = 158;
static const JSC::Intrinsic s_transformStreamReadableCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamReadableCode = "(function (){\"use strict\";if(!@isTransformStream(this))throw @makeThisTypeError(\"TransformStream\",\"readable\");return @getByIdDirectPrivate(this,\"readable\")})\n";

// writable
const JSC::ConstructAbility s_transformStreamWritableCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamWritableCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamWritableCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamWritableCodeLength = 158;
static const JSC::Intrinsic s_transformStreamWritableCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamWritableCode = "(function (){\"use strict\";if(!@isTransformStream(this))throw @makeThisTypeError(\"TransformStream\",\"writable\");return @getByIdDirectPrivate(this,\"writable\")})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().transformStreamBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().transformStreamBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_TRANSFORMSTREAM_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* JSBufferPrototype.ts */
// setBigUint64
const JSC::ConstructAbility s_jsBufferPrototypeSetBigUint64CodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeSetBigUint64CodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeSetBigUint64CodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeSetBigUint64CodeLength = 136;
static const JSC::Intrinsic s_jsBufferPrototypeSetBigUint64CodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeSetBigUint64Code = "(function (r,a,c){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setBigUint64(r,a,c)})\n";

// readInt8
const JSC::ConstructAbility s_jsBufferPrototypeReadInt8CodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadInt8CodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadInt8CodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadInt8CodeLength = 123;
static const JSC::Intrinsic s_jsBufferPrototypeReadInt8CodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadInt8Code = "(function (r){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getInt8(r)})\n";

// readUInt8
const JSC::ConstructAbility s_jsBufferPrototypeReadUInt8CodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadUInt8CodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadUInt8CodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadUInt8CodeLength = 124;
static const JSC::Intrinsic s_jsBufferPrototypeReadUInt8CodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadUInt8Code = "(function (a){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getUint8(a)})\n";

// readInt16LE
const JSC::ConstructAbility s_jsBufferPrototypeReadInt16LECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadInt16LECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadInt16LECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadInt16LECodeLength = 127;
static const JSC::Intrinsic s_jsBufferPrototypeReadInt16LECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadInt16LECode = "(function (a){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getInt16(a,!0)})\n";

// readInt16BE
const JSC::ConstructAbility s_jsBufferPrototypeReadInt16BECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadInt16BECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadInt16BECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadInt16BECodeLength = 127;
static const JSC::Intrinsic s_jsBufferPrototypeReadInt16BECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadInt16BECode = "(function (a){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getInt16(a,!1)})\n";

// readUInt16LE
const JSC::ConstructAbility s_jsBufferPrototypeReadUInt16LECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadUInt16LECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadUInt16LECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadUInt16LECodeLength = 128;
static const JSC::Intrinsic s_jsBufferPrototypeReadUInt16LECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadUInt16LECode = "(function (a){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getUint16(a,!0)})\n";

// readUInt16BE
const JSC::ConstructAbility s_jsBufferPrototypeReadUInt16BECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadUInt16BECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadUInt16BECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadUInt16BECodeLength = 128;
static const JSC::Intrinsic s_jsBufferPrototypeReadUInt16BECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadUInt16BECode = "(function (a){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getUint16(a,!1)})\n";

// readInt32LE
const JSC::ConstructAbility s_jsBufferPrototypeReadInt32LECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadInt32LECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadInt32LECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadInt32LECodeLength = 127;
static const JSC::Intrinsic s_jsBufferPrototypeReadInt32LECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadInt32LECode = "(function (a){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getInt32(a,!0)})\n";

// readInt32BE
const JSC::ConstructAbility s_jsBufferPrototypeReadInt32BECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadInt32BECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadInt32BECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadInt32BECodeLength = 127;
static const JSC::Intrinsic s_jsBufferPrototypeReadInt32BECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadInt32BECode = "(function (a){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getInt32(a,!1)})\n";

// readUInt32LE
const JSC::ConstructAbility s_jsBufferPrototypeReadUInt32LECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadUInt32LECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadUInt32LECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadUInt32LECodeLength = 128;
static const JSC::Intrinsic s_jsBufferPrototypeReadUInt32LECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadUInt32LECode = "(function (a){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getUint32(a,!0)})\n";

// readUInt32BE
const JSC::ConstructAbility s_jsBufferPrototypeReadUInt32BECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadUInt32BECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadUInt32BECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadUInt32BECodeLength = 128;
static const JSC::Intrinsic s_jsBufferPrototypeReadUInt32BECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadUInt32BECode = "(function (a){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getUint32(a,!1)})\n";

// readIntLE
const JSC::ConstructAbility s_jsBufferPrototypeReadIntLECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadIntLECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadIntLECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadIntLECodeLength = 528;
static const JSC::Intrinsic s_jsBufferPrototypeReadIntLECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadIntLECode = "(function (u,c){\"use strict\";const d=this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength);switch(c){case 1:return d.getInt8(u);case 2:return d.getInt16(u,!0);case 3:{const r=d.getUint16(u,!0)+d.getUint8(u+2)*65536;return r|(r&8388608)*510}case 4:return d.getInt32(u,!0);case 5:{const r=d.getUint8(u+4);return(r|(r&128)*33554430)*4294967296+d.getUint32(u,!0)}case 6:{const r=d.getUint16(u+4,!0);return(r|(r&32768)*131070)*4294967296+d.getUint32(u,!0)}}@throwRangeError(\"byteLength must be >= 1 and <= 6\")})\n";

// readIntBE
const JSC::ConstructAbility s_jsBufferPrototypeReadIntBECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadIntBECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadIntBECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadIntBECodeLength = 528;
static const JSC::Intrinsic s_jsBufferPrototypeReadIntBECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadIntBECode = "(function (r,u){\"use strict\";const _=this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength);switch(u){case 1:return _.getInt8(r);case 2:return _.getInt16(r,!1);case 3:{const c=_.getUint16(r+1,!1)+_.getUint8(r)*65536;return c|(c&8388608)*510}case 4:return _.getInt32(r,!1);case 5:{const c=_.getUint8(r);return(c|(c&128)*33554430)*4294967296+_.getUint32(r+1,!1)}case 6:{const c=_.getUint16(r,!1);return(c|(c&32768)*131070)*4294967296+_.getUint32(r+2,!1)}}@throwRangeError(\"byteLength must be >= 1 and <= 6\")})\n";

// readUIntLE
const JSC::ConstructAbility s_jsBufferPrototypeReadUIntLECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadUIntLECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadUIntLECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadUIntLECodeLength = 445;
static const JSC::Intrinsic s_jsBufferPrototypeReadUIntLECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadUIntLECode = "(function (a,c){\"use strict\";const r=this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength);switch(c){case 1:return r.getUint8(a);case 2:return r.getUint16(a,!0);case 3:return r.getUint16(a,!0)+r.getUint8(a+2)*65536;case 4:return r.getUint32(a,!0);case 5:return r.getUint8(a+4)*4294967296+r.getUint32(a,!0);case 6:return r.getUint16(a+4,!0)*4294967296+r.getUint32(a,!0)}@throwRangeError(\"byteLength must be >= 1 and <= 6\")})\n";

// readUIntBE
const JSC::ConstructAbility s_jsBufferPrototypeReadUIntBECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadUIntBECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadUIntBECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadUIntBECodeLength = 504;
static const JSC::Intrinsic s_jsBufferPrototypeReadUIntBECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadUIntBECode = "(function (c,r){\"use strict\";const d=this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength);switch(r){case 1:return d.getUint8(c);case 2:return d.getUint16(c,!1);case 3:return d.getUint16(c+1,!1)+d.getUint8(c)*65536;case 4:return d.getUint32(c,!1);case 5:{const p=d.getUint8(c);return(p|(p&128)*33554430)*4294967296+d.getUint32(c+1,!1)}case 6:{const p=d.getUint16(c,!1);return(p|(p&32768)*131070)*4294967296+d.getUint32(c+2,!1)}}@throwRangeError(\"byteLength must be >= 1 and <= 6\")})\n";

// readFloatLE
const JSC::ConstructAbility s_jsBufferPrototypeReadFloatLECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadFloatLECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadFloatLECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadFloatLECodeLength = 129;
static const JSC::Intrinsic s_jsBufferPrototypeReadFloatLECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadFloatLECode = "(function (a){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getFloat32(a,!0)})\n";

// readFloatBE
const JSC::ConstructAbility s_jsBufferPrototypeReadFloatBECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadFloatBECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadFloatBECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadFloatBECodeLength = 129;
static const JSC::Intrinsic s_jsBufferPrototypeReadFloatBECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadFloatBECode = "(function (a){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getFloat32(a,!1)})\n";

// readDoubleLE
const JSC::ConstructAbility s_jsBufferPrototypeReadDoubleLECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadDoubleLECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadDoubleLECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadDoubleLECodeLength = 129;
static const JSC::Intrinsic s_jsBufferPrototypeReadDoubleLECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadDoubleLECode = "(function (a){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getFloat64(a,!0)})\n";

// readDoubleBE
const JSC::ConstructAbility s_jsBufferPrototypeReadDoubleBECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadDoubleBECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadDoubleBECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadDoubleBECodeLength = 129;
static const JSC::Intrinsic s_jsBufferPrototypeReadDoubleBECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadDoubleBECode = "(function (a){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getFloat64(a,!1)})\n";

// readBigInt64LE
const JSC::ConstructAbility s_jsBufferPrototypeReadBigInt64LECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadBigInt64LECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadBigInt64LECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadBigInt64LECodeLength = 130;
static const JSC::Intrinsic s_jsBufferPrototypeReadBigInt64LECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadBigInt64LECode = "(function (a){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getBigInt64(a,!0)})\n";

// readBigInt64BE
const JSC::ConstructAbility s_jsBufferPrototypeReadBigInt64BECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadBigInt64BECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadBigInt64BECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadBigInt64BECodeLength = 130;
static const JSC::Intrinsic s_jsBufferPrototypeReadBigInt64BECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadBigInt64BECode = "(function (a){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getBigInt64(a,!1)})\n";

// readBigUInt64LE
const JSC::ConstructAbility s_jsBufferPrototypeReadBigUInt64LECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadBigUInt64LECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadBigUInt64LECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadBigUInt64LECodeLength = 131;
static const JSC::Intrinsic s_jsBufferPrototypeReadBigUInt64LECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadBigUInt64LECode = "(function (a){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getBigUint64(a,!0)})\n";

// readBigUInt64BE
const JSC::ConstructAbility s_jsBufferPrototypeReadBigUInt64BECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeReadBigUInt64BECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeReadBigUInt64BECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeReadBigUInt64BECodeLength = 131;
static const JSC::Intrinsic s_jsBufferPrototypeReadBigUInt64BECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeReadBigUInt64BECode = "(function (a){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).getBigUint64(a,!1)})\n";

// writeInt8
const JSC::ConstructAbility s_jsBufferPrototypeWriteInt8CodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteInt8CodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteInt8CodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteInt8CodeLength = 131;
static const JSC::Intrinsic s_jsBufferPrototypeWriteInt8CodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteInt8Code = "(function (n,d){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setInt8(d,n),d+1})\n";

// writeUInt8
const JSC::ConstructAbility s_jsBufferPrototypeWriteUInt8CodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteUInt8CodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteUInt8CodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteUInt8CodeLength = 132;
static const JSC::Intrinsic s_jsBufferPrototypeWriteUInt8CodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteUInt8Code = "(function (n,d){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setUint8(d,n),d+1})\n";

// writeInt16LE
const JSC::ConstructAbility s_jsBufferPrototypeWriteInt16LECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteInt16LECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteInt16LECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteInt16LECodeLength = 135;
static const JSC::Intrinsic s_jsBufferPrototypeWriteInt16LECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteInt16LECode = "(function (r,n){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setInt16(n,r,!0),n+2})\n";

// writeInt16BE
const JSC::ConstructAbility s_jsBufferPrototypeWriteInt16BECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteInt16BECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteInt16BECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteInt16BECodeLength = 135;
static const JSC::Intrinsic s_jsBufferPrototypeWriteInt16BECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteInt16BECode = "(function (a,n){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setInt16(n,a,!1),n+2})\n";

// writeUInt16LE
const JSC::ConstructAbility s_jsBufferPrototypeWriteUInt16LECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteUInt16LECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteUInt16LECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteUInt16LECodeLength = 136;
static const JSC::Intrinsic s_jsBufferPrototypeWriteUInt16LECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteUInt16LECode = "(function (n,r){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setUint16(r,n,!0),r+2})\n";

// writeUInt16BE
const JSC::ConstructAbility s_jsBufferPrototypeWriteUInt16BECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteUInt16BECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteUInt16BECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteUInt16BECodeLength = 136;
static const JSC::Intrinsic s_jsBufferPrototypeWriteUInt16BECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteUInt16BECode = "(function (n,r){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setUint16(r,n,!1),r+2})\n";

// writeInt32LE
const JSC::ConstructAbility s_jsBufferPrototypeWriteInt32LECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteInt32LECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteInt32LECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteInt32LECodeLength = 135;
static const JSC::Intrinsic s_jsBufferPrototypeWriteInt32LECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteInt32LECode = "(function (r,n){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setInt32(n,r,!0),n+4})\n";

// writeInt32BE
const JSC::ConstructAbility s_jsBufferPrototypeWriteInt32BECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteInt32BECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteInt32BECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteInt32BECodeLength = 135;
static const JSC::Intrinsic s_jsBufferPrototypeWriteInt32BECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteInt32BECode = "(function (a,n){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setInt32(n,a,!1),n+4})\n";

// writeUInt32LE
const JSC::ConstructAbility s_jsBufferPrototypeWriteUInt32LECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteUInt32LECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteUInt32LECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteUInt32LECodeLength = 136;
static const JSC::Intrinsic s_jsBufferPrototypeWriteUInt32LECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteUInt32LECode = "(function (n,r){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setUint32(r,n,!0),r+4})\n";

// writeUInt32BE
const JSC::ConstructAbility s_jsBufferPrototypeWriteUInt32BECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteUInt32BECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteUInt32BECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteUInt32BECodeLength = 136;
static const JSC::Intrinsic s_jsBufferPrototypeWriteUInt32BECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteUInt32BECode = "(function (n,r){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setUint32(r,n,!1),r+4})\n";

// writeIntLE
const JSC::ConstructAbility s_jsBufferPrototypeWriteIntLECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteIntLECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteIntLECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteIntLECodeLength = 573;
static const JSC::Intrinsic s_jsBufferPrototypeWriteIntLECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteIntLECode = "(function (c,r,d){\"use strict\";const p=this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength);switch(d){case 1:{p.setInt8(r,c);break}case 2:{p.setInt16(r,c,!0);break}case 3:{p.setUint16(r,c&65535,!0),p.setInt8(r+2,Math.floor(c*0.0000152587890625));break}case 4:{p.setInt32(r,c,!0);break}case 5:{p.setUint32(r,c|0,!0),p.setInt8(r+4,Math.floor(c*0.00000000023283064365386964));break}case 6:{p.setUint32(r,c|0,!0),p.setInt16(r+4,Math.floor(c*0.00000000023283064365386964),!0);break}default:@throwRangeError(\"byteLength must be >= 1 and <= 6\")}return r+d})\n";

// writeIntBE
const JSC::ConstructAbility s_jsBufferPrototypeWriteIntBECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteIntBECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteIntBECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteIntBECodeLength = 573;
static const JSC::Intrinsic s_jsBufferPrototypeWriteIntBECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteIntBECode = "(function (c,r,x){\"use strict\";const d=this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength);switch(x){case 1:{d.setInt8(r,c);break}case 2:{d.setInt16(r,c,!1);break}case 3:{d.setUint16(r+1,c&65535,!1),d.setInt8(r,Math.floor(c*0.0000152587890625));break}case 4:{d.setInt32(r,c,!1);break}case 5:{d.setUint32(r+1,c|0,!1),d.setInt8(r,Math.floor(c*0.00000000023283064365386964));break}case 6:{d.setUint32(r+2,c|0,!1),d.setInt16(r,Math.floor(c*0.00000000023283064365386964),!1);break}default:@throwRangeError(\"byteLength must be >= 1 and <= 6\")}return r+x})\n";

// writeUIntLE
const JSC::ConstructAbility s_jsBufferPrototypeWriteUIntLECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteUIntLECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteUIntLECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteUIntLECodeLength = 579;
static const JSC::Intrinsic s_jsBufferPrototypeWriteUIntLECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteUIntLECode = "(function (k,r,c){\"use strict\";const d=this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength);switch(c){case 1:{d.setUint8(r,k);break}case 2:{d.setUint16(r,k,!0);break}case 3:{d.setUint16(r,k&65535,!0),d.setUint8(r+2,Math.floor(k*0.0000152587890625));break}case 4:{d.setUint32(r,k,!0);break}case 5:{d.setUint32(r,k|0,!0),d.setUint8(r+4,Math.floor(k*0.00000000023283064365386964));break}case 6:{d.setUint32(r,k|0,!0),d.setUint16(r+4,Math.floor(k*0.00000000023283064365386964),!0);break}default:@throwRangeError(\"byteLength must be >= 1 and <= 6\")}return r+c})\n";

// writeUIntBE
const JSC::ConstructAbility s_jsBufferPrototypeWriteUIntBECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteUIntBECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteUIntBECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteUIntBECodeLength = 579;
static const JSC::Intrinsic s_jsBufferPrototypeWriteUIntBECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteUIntBECode = "(function (r,c,d){\"use strict\";const E=this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength);switch(d){case 1:{E.setUint8(c,r);break}case 2:{E.setUint16(c,r,!1);break}case 3:{E.setUint16(c+1,r&65535,!1),E.setUint8(c,Math.floor(r*0.0000152587890625));break}case 4:{E.setUint32(c,r,!1);break}case 5:{E.setUint32(c+1,r|0,!1),E.setUint8(c,Math.floor(r*0.00000000023283064365386964));break}case 6:{E.setUint32(c+2,r|0,!1),E.setUint16(c,Math.floor(r*0.00000000023283064365386964),!1);break}default:@throwRangeError(\"byteLength must be >= 1 and <= 6\")}return c+d})\n";

// writeFloatLE
const JSC::ConstructAbility s_jsBufferPrototypeWriteFloatLECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteFloatLECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteFloatLECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteFloatLECodeLength = 137;
static const JSC::Intrinsic s_jsBufferPrototypeWriteFloatLECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteFloatLECode = "(function (n,r){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setFloat32(r,n,!0),r+4})\n";

// writeFloatBE
const JSC::ConstructAbility s_jsBufferPrototypeWriteFloatBECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteFloatBECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteFloatBECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteFloatBECodeLength = 137;
static const JSC::Intrinsic s_jsBufferPrototypeWriteFloatBECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteFloatBECode = "(function (n,r){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setFloat32(r,n,!1),r+4})\n";

// writeDoubleLE
const JSC::ConstructAbility s_jsBufferPrototypeWriteDoubleLECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteDoubleLECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteDoubleLECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteDoubleLECodeLength = 137;
static const JSC::Intrinsic s_jsBufferPrototypeWriteDoubleLECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteDoubleLECode = "(function (n,r){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setFloat64(r,n,!0),r+8})\n";

// writeDoubleBE
const JSC::ConstructAbility s_jsBufferPrototypeWriteDoubleBECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteDoubleBECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteDoubleBECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteDoubleBECodeLength = 137;
static const JSC::Intrinsic s_jsBufferPrototypeWriteDoubleBECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteDoubleBECode = "(function (n,r){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setFloat64(r,n,!1),r+8})\n";

// writeBigInt64LE
const JSC::ConstructAbility s_jsBufferPrototypeWriteBigInt64LECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteBigInt64LECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteBigInt64LECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteBigInt64LECodeLength = 138;
static const JSC::Intrinsic s_jsBufferPrototypeWriteBigInt64LECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteBigInt64LECode = "(function (n,r){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setBigInt64(r,n,!0),r+8})\n";

// writeBigInt64BE
const JSC::ConstructAbility s_jsBufferPrototypeWriteBigInt64BECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteBigInt64BECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteBigInt64BECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteBigInt64BECodeLength = 138;
static const JSC::Intrinsic s_jsBufferPrototypeWriteBigInt64BECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteBigInt64BECode = "(function (n,r){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setBigInt64(r,n,!1),r+8})\n";

// writeBigUInt64LE
const JSC::ConstructAbility s_jsBufferPrototypeWriteBigUInt64LECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteBigUInt64LECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteBigUInt64LECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteBigUInt64LECodeLength = 139;
static const JSC::Intrinsic s_jsBufferPrototypeWriteBigUInt64LECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteBigUInt64LECode = "(function (n,r){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setBigUint64(r,n,!0),r+8})\n";

// writeBigUInt64BE
const JSC::ConstructAbility s_jsBufferPrototypeWriteBigUInt64BECodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeWriteBigUInt64BECodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeWriteBigUInt64BECodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeWriteBigUInt64BECodeLength = 139;
static const JSC::Intrinsic s_jsBufferPrototypeWriteBigUInt64BECodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeWriteBigUInt64BECode = "(function (n,r){\"use strict\";return(this.@dataView||=new DataView(this.buffer,this.byteOffset,this.byteLength)).setBigUint64(r,n,!1),r+8})\n";

// utf8Write
const JSC::ConstructAbility s_jsBufferPrototypeUtf8WriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeUtf8WriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeUtf8WriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeUtf8WriteCodeLength = 65;
static const JSC::Intrinsic s_jsBufferPrototypeUtf8WriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeUtf8WriteCode = "(function (a,r,c){\"use strict\";return this.write(a,r,c,\"utf8\")})\n";

// ucs2Write
const JSC::ConstructAbility s_jsBufferPrototypeUcs2WriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeUcs2WriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeUcs2WriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeUcs2WriteCodeLength = 65;
static const JSC::Intrinsic s_jsBufferPrototypeUcs2WriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeUcs2WriteCode = "(function (a,r,c){\"use strict\";return this.write(a,r,c,\"ucs2\")})\n";

// utf16leWrite
const JSC::ConstructAbility s_jsBufferPrototypeUtf16leWriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeUtf16leWriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeUtf16leWriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeUtf16leWriteCodeLength = 68;
static const JSC::Intrinsic s_jsBufferPrototypeUtf16leWriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeUtf16leWriteCode = "(function (a,r,c){\"use strict\";return this.write(a,r,c,\"utf16le\")})\n";

// latin1Write
const JSC::ConstructAbility s_jsBufferPrototypeLatin1WriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeLatin1WriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeLatin1WriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeLatin1WriteCodeLength = 67;
static const JSC::Intrinsic s_jsBufferPrototypeLatin1WriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeLatin1WriteCode = "(function (a,r,c){\"use strict\";return this.write(a,r,c,\"latin1\")})\n";

// asciiWrite
const JSC::ConstructAbility s_jsBufferPrototypeAsciiWriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeAsciiWriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeAsciiWriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeAsciiWriteCodeLength = 66;
static const JSC::Intrinsic s_jsBufferPrototypeAsciiWriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeAsciiWriteCode = "(function (a,r,c){\"use strict\";return this.write(a,r,c,\"ascii\")})\n";

// base64Write
const JSC::ConstructAbility s_jsBufferPrototypeBase64WriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeBase64WriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeBase64WriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeBase64WriteCodeLength = 67;
static const JSC::Intrinsic s_jsBufferPrototypeBase64WriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeBase64WriteCode = "(function (a,r,c){\"use strict\";return this.write(a,r,c,\"base64\")})\n";

// base64urlWrite
const JSC::ConstructAbility s_jsBufferPrototypeBase64urlWriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeBase64urlWriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeBase64urlWriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeBase64urlWriteCodeLength = 70;
static const JSC::Intrinsic s_jsBufferPrototypeBase64urlWriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeBase64urlWriteCode = "(function (r,a,c){\"use strict\";return this.write(r,a,c,\"base64url\")})\n";

// hexWrite
const JSC::ConstructAbility s_jsBufferPrototypeHexWriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeHexWriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeHexWriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeHexWriteCodeLength = 64;
static const JSC::Intrinsic s_jsBufferPrototypeHexWriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeHexWriteCode = "(function (a,r,c){\"use strict\";return this.write(a,r,c,\"hex\")})\n";

// utf8Slice
const JSC::ConstructAbility s_jsBufferPrototypeUtf8SliceCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeUtf8SliceCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeUtf8SliceCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeUtf8SliceCodeLength = 64;
static const JSC::Intrinsic s_jsBufferPrototypeUtf8SliceCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeUtf8SliceCode = "(function (r,a){\"use strict\";return this.toString(r,a,\"utf8\")})\n";

// ucs2Slice
const JSC::ConstructAbility s_jsBufferPrototypeUcs2SliceCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeUcs2SliceCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeUcs2SliceCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeUcs2SliceCodeLength = 64;
static const JSC::Intrinsic s_jsBufferPrototypeUcs2SliceCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeUcs2SliceCode = "(function (r,a){\"use strict\";return this.toString(r,a,\"ucs2\")})\n";

// utf16leSlice
const JSC::ConstructAbility s_jsBufferPrototypeUtf16leSliceCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeUtf16leSliceCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeUtf16leSliceCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeUtf16leSliceCodeLength = 67;
static const JSC::Intrinsic s_jsBufferPrototypeUtf16leSliceCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeUtf16leSliceCode = "(function (a,r){\"use strict\";return this.toString(a,r,\"utf16le\")})\n";

// latin1Slice
const JSC::ConstructAbility s_jsBufferPrototypeLatin1SliceCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeLatin1SliceCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeLatin1SliceCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeLatin1SliceCodeLength = 66;
static const JSC::Intrinsic s_jsBufferPrototypeLatin1SliceCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeLatin1SliceCode = "(function (a,r){\"use strict\";return this.toString(a,r,\"latin1\")})\n";

// asciiSlice
const JSC::ConstructAbility s_jsBufferPrototypeAsciiSliceCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeAsciiSliceCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeAsciiSliceCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeAsciiSliceCodeLength = 65;
static const JSC::Intrinsic s_jsBufferPrototypeAsciiSliceCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeAsciiSliceCode = "(function (a,r){\"use strict\";return this.toString(a,r,\"ascii\")})\n";

// base64Slice
const JSC::ConstructAbility s_jsBufferPrototypeBase64SliceCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeBase64SliceCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeBase64SliceCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeBase64SliceCodeLength = 66;
static const JSC::Intrinsic s_jsBufferPrototypeBase64SliceCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeBase64SliceCode = "(function (a,r){\"use strict\";return this.toString(a,r,\"base64\")})\n";

// base64urlSlice
const JSC::ConstructAbility s_jsBufferPrototypeBase64urlSliceCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeBase64urlSliceCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeBase64urlSliceCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeBase64urlSliceCodeLength = 69;
static const JSC::Intrinsic s_jsBufferPrototypeBase64urlSliceCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeBase64urlSliceCode = "(function (a,r){\"use strict\";return this.toString(a,r,\"base64url\")})\n";

// hexSlice
const JSC::ConstructAbility s_jsBufferPrototypeHexSliceCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeHexSliceCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeHexSliceCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeHexSliceCodeLength = 63;
static const JSC::Intrinsic s_jsBufferPrototypeHexSliceCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeHexSliceCode = "(function (r,a){\"use strict\";return this.toString(r,a,\"hex\")})\n";

// toJSON
const JSC::ConstructAbility s_jsBufferPrototypeToJSONCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeToJSONCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeToJSONCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeToJSONCodeLength = 73;
static const JSC::Intrinsic s_jsBufferPrototypeToJSONCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeToJSONCode = "(function (){\"use strict\";return{type:\"Buffer\",data:@Array.from(this)}})\n";

// slice
const JSC::ConstructAbility s_jsBufferPrototypeSliceCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeSliceCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeSliceCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeSliceCodeLength = 260;
static const JSC::Intrinsic s_jsBufferPrototypeSliceCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeSliceCode = "(function (c,p){\"use strict\";var{buffer:N,byteOffset:i,byteLength:k}=this;function m(w,x){if(w=@trunc(w),w===0||@isNaN(w))return 0;else if(w<0)return w+=x,w>0\?w:0;else return w<x\?w:x}var q=m(c,k),v=p!==@undefined\?m(p,k):k;return new @Buffer(N,i+q,v>q\?v-q:0)})\n";

// parent
const JSC::ConstructAbility s_jsBufferPrototypeParentCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeParentCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeParentCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeParentCodeLength = 99;
static const JSC::Intrinsic s_jsBufferPrototypeParentCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeParentCode = "(function (){\"use strict\";return @isObject(this)&&this instanceof @Buffer\?this.buffer:@undefined})\n";

// offset
const JSC::ConstructAbility s_jsBufferPrototypeOffsetCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferPrototypeOffsetCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferPrototypeOffsetCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferPrototypeOffsetCodeLength = 103;
static const JSC::Intrinsic s_jsBufferPrototypeOffsetCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferPrototypeOffsetCode = "(function (){\"use strict\";return @isObject(this)&&this instanceof @Buffer\?this.byteOffset:@undefined})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().jsBufferPrototypeBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().jsBufferPrototypeBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_JSBUFFERPROTOTYPE_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ReadableByteStreamController.ts */
// initializeReadableByteStreamController
const JSC::ConstructAbility s_readableByteStreamControllerInitializeReadableByteStreamControllerCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamControllerInitializeReadableByteStreamControllerCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamControllerInitializeReadableByteStreamControllerCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamControllerInitializeReadableByteStreamControllerCodeLength = 253;
static const JSC::Intrinsic s_readableByteStreamControllerInitializeReadableByteStreamControllerCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamControllerInitializeReadableByteStreamControllerCode = "(function (_,b,f){\"use strict\";if(arguments.length!==4&&arguments[3]!==@isReadableStream)@throwTypeError(\"ReadableByteStreamController constructor should not be called directly\");return @privateInitializeReadableByteStreamController.@call(this,_,b,f)})\n";

// enqueue
const JSC::ConstructAbility s_readableByteStreamControllerEnqueueCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamControllerEnqueueCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamControllerEnqueueCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamControllerEnqueueCodeLength = 561;
static const JSC::Intrinsic s_readableByteStreamControllerEnqueueCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamControllerEnqueueCode = "(function (t){\"use strict\";if(!@isReadableByteStreamController(this))throw @makeThisTypeError(\"ReadableByteStreamController\",\"enqueue\");if(@getByIdDirectPrivate(this,\"closeRequested\"))@throwTypeError(\"ReadableByteStreamController is requested to close\");if(@getByIdDirectPrivate(@getByIdDirectPrivate(this,\"controlledReadableStream\"),\"state\")!==@streamReadable)@throwTypeError(\"ReadableStream is not readable\");if(!@isObject(t)||!ArrayBuffer.@isView(t))@throwTypeError(\"Provided chunk is not a TypedArray\");return @readableByteStreamControllerEnqueue(this,t)})\n";

// error
const JSC::ConstructAbility s_readableByteStreamControllerErrorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamControllerErrorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamControllerErrorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamControllerErrorCodeLength = 336;
static const JSC::Intrinsic s_readableByteStreamControllerErrorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamControllerErrorCode = "(function (i){\"use strict\";if(!@isReadableByteStreamController(this))throw @makeThisTypeError(\"ReadableByteStreamController\",\"error\");if(@getByIdDirectPrivate(@getByIdDirectPrivate(this,\"controlledReadableStream\"),\"state\")!==@streamReadable)@throwTypeError(\"ReadableStream is not readable\");@readableByteStreamControllerError(this,i)})\n";

// close
const JSC::ConstructAbility s_readableByteStreamControllerCloseCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamControllerCloseCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamControllerCloseCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamControllerCloseCodeLength = 433;
static const JSC::Intrinsic s_readableByteStreamControllerCloseCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamControllerCloseCode = "(function (){\"use strict\";if(!@isReadableByteStreamController(this))throw @makeThisTypeError(\"ReadableByteStreamController\",\"close\");if(@getByIdDirectPrivate(this,\"closeRequested\"))@throwTypeError(\"Close has already been requested\");if(@getByIdDirectPrivate(@getByIdDirectPrivate(this,\"controlledReadableStream\"),\"state\")!==@streamReadable)@throwTypeError(\"ReadableStream is not readable\");@readableByteStreamControllerClose(this)})\n";

// byobRequest
const JSC::ConstructAbility s_readableByteStreamControllerByobRequestCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamControllerByobRequestCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamControllerByobRequestCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamControllerByobRequestCodeLength = 523;
static const JSC::Intrinsic s_readableByteStreamControllerByobRequestCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamControllerByobRequestCode = "(function (){\"use strict\";if(!@isReadableByteStreamController(this))throw @makeGetterTypeError(\"ReadableByteStreamController\",\"byobRequest\");var a=@getByIdDirectPrivate(this,\"byobRequest\");if(a===@undefined){var _=@getByIdDirectPrivate(this,\"pendingPullIntos\");const b=_.peek();if(b){const d=new @Uint8Array(b.buffer,b.byteOffset+b.bytesFilled,b.byteLength-b.bytesFilled);@putByIdDirectPrivate(this,\"byobRequest\",new @ReadableStreamBYOBRequest(this,d,@isReadableStream))}}return @getByIdDirectPrivate(this,\"byobRequest\")})\n";

// desiredSize
const JSC::ConstructAbility s_readableByteStreamControllerDesiredSizeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamControllerDesiredSizeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamControllerDesiredSizeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamControllerDesiredSizeCodeLength = 200;
static const JSC::Intrinsic s_readableByteStreamControllerDesiredSizeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamControllerDesiredSizeCode = "(function (){\"use strict\";if(!@isReadableByteStreamController(this))throw @makeGetterTypeError(\"ReadableByteStreamController\",\"desiredSize\");return @readableByteStreamControllerGetDesiredSize(this)})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().readableByteStreamControllerBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().readableByteStreamControllerBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_READABLEBYTESTREAMCONTROLLER_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ConsoleObject.ts */
// asyncIterator
const JSC::ConstructAbility s_consoleObjectAsyncIteratorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_consoleObjectAsyncIteratorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_consoleObjectAsyncIteratorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_consoleObjectAsyncIteratorCodeLength = 577;
static const JSC::Intrinsic s_consoleObjectAsyncIteratorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_consoleObjectAsyncIteratorCode = "(function (){\"use strict\";const y=async function*j(){var w=@Bun.stdin.stream().getReader(),z=new globalThis.TextDecoder(\"utf-8\",{fatal:!1}),A,B=@Bun.indexOfLine;try{while(!0){var D,F,G;const L=w.readMany();if(@isPromise(L))({done:D,value:F}=await L);else({done:D,value:F}=L);if(D){if(G)yield z.decode(G);return}var H;for(let M of F){if(H=M,G)H=@Buffer.concat([G,M]),G=null;var J=0,K=B(H,J);while(K!==-1)yield z.decode(H.subarray(J,K)),J=K+1,K=B(H,J);G=H.subarray(J)}}}catch(L){A=L}finally{if(w.releaseLock(),A)throw A}},_=globalThis.Symbol.asyncIterator;return this[_]=y,y()})\n";

// write
const JSC::ConstructAbility s_consoleObjectWriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_consoleObjectWriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_consoleObjectWriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_consoleObjectWriteCodeLength = 310;
static const JSC::Intrinsic s_consoleObjectWriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_consoleObjectWriteCode = "(function (a){\"use strict\";var s=@getByIdDirectPrivate(this,\"writer\");if(!s){var _=@toLength(a\?.length\?\?0);s=@Bun.stdout.writer({highWaterMark:_>65536\?_:65536}),@putByIdDirectPrivate(this,\"writer\",s)}var d=s.write(a);const D=@argumentCount();for(var b=1;b<D;b++)d+=s.write(@argument(b));return s.flush(!0),d})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().consoleObjectBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().consoleObjectBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ReadableStreamInternals.ts */
// readableStreamReaderGenericInitialize
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamReaderGenericInitializeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamReaderGenericInitializeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamReaderGenericInitializeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamReaderGenericInitializeCodeLength = 585;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamReaderGenericInitializeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamReaderGenericInitializeCode = "(function (n,_){\"use strict\";if(@putByIdDirectPrivate(n,\"ownerReadableStream\",_),@putByIdDirectPrivate(_,\"reader\",n),@getByIdDirectPrivate(_,\"state\")===@streamReadable)@putByIdDirectPrivate(n,\"closedPromiseCapability\",@newPromiseCapability(@Promise));else if(@getByIdDirectPrivate(_,\"state\")===@streamClosed)@putByIdDirectPrivate(n,\"closedPromiseCapability\",{@promise:@Promise.@resolve()});else @assert(@getByIdDirectPrivate(_,\"state\")===@streamErrored),@putByIdDirectPrivate(n,\"closedPromiseCapability\",{@promise:@newHandledRejectedPromise(@getByIdDirectPrivate(_,\"storedError\"))})})\n";

// privateInitializeReadableStreamDefaultController
const JSC::ConstructAbility s_readableStreamInternalsPrivateInitializeReadableStreamDefaultControllerCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsPrivateInitializeReadableStreamDefaultControllerCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsPrivateInitializeReadableStreamDefaultControllerCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsPrivateInitializeReadableStreamDefaultControllerCodeLength = 675;
static const JSC::Intrinsic s_readableStreamInternalsPrivateInitializeReadableStreamDefaultControllerCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsPrivateInitializeReadableStreamDefaultControllerCode = "(function (_,i,n,p){\"use strict\";if(!@isReadableStream(_))@throwTypeError(\"ReadableStreamDefaultController needs a ReadableStream\");if(@getByIdDirectPrivate(_,\"readableStreamController\")!==null)@throwTypeError(\"ReadableStream already has a controller\");return @putByIdDirectPrivate(this,\"controlledReadableStream\",_),@putByIdDirectPrivate(this,\"underlyingSource\",i),@putByIdDirectPrivate(this,\"queue\",@newQueue()),@putByIdDirectPrivate(this,\"started\",-1),@putByIdDirectPrivate(this,\"closeRequested\",!1),@putByIdDirectPrivate(this,\"pullAgain\",!1),@putByIdDirectPrivate(this,\"pulling\",!1),@putByIdDirectPrivate(this,\"strategy\",@validateAndNormalizeQueuingStrategy(n,p)),this})\n";

// readableStreamDefaultControllerError
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamDefaultControllerErrorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamDefaultControllerErrorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamDefaultControllerErrorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamDefaultControllerErrorCodeLength = 223;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamDefaultControllerErrorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamDefaultControllerErrorCode = "(function (d,u){\"use strict\";const _=@getByIdDirectPrivate(d,\"controlledReadableStream\");if(@getByIdDirectPrivate(_,\"state\")!==@streamReadable)return;@putByIdDirectPrivate(d,\"queue\",@newQueue()),@readableStreamError(_,u)})\n";

// readableStreamPipeTo
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamPipeToCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamPipeToCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamPipeToCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamPipeToCodeLength = 427;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamPipeToCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamPipeToCode = "(function (c,f){\"use strict\";@assert(@isReadableStream(c));const q=new @ReadableStreamDefaultReader(c);@getByIdDirectPrivate(q,\"closedPromiseCapability\").@promise.@then(()=>{},(_)=>{f.error(_)});function R(){@readableStreamDefaultReaderRead(q).@then(function(_){if(_.done){f.close();return}try{f.enqueue(_.value)}catch(b){f.error(\"ReadableStream chunk enqueueing in the sink failed\");return}R()},function(_){f.error(_)})}R()})\n";

// acquireReadableStreamDefaultReader
const JSC::ConstructAbility s_readableStreamInternalsAcquireReadableStreamDefaultReaderCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsAcquireReadableStreamDefaultReaderCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsAcquireReadableStreamDefaultReaderCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsAcquireReadableStreamDefaultReaderCodeLength = 127;
static const JSC::Intrinsic s_readableStreamInternalsAcquireReadableStreamDefaultReaderCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsAcquireReadableStreamDefaultReaderCode = "(function (d){\"use strict\";var c=@getByIdDirectPrivate(d,\"start\");if(c)c.@call(d);return new @ReadableStreamDefaultReader(d)})\n";

// setupReadableStreamDefaultController
const JSC::ConstructAbility s_readableStreamInternalsSetupReadableStreamDefaultControllerCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsSetupReadableStreamDefaultControllerCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsSetupReadableStreamDefaultControllerCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsSetupReadableStreamDefaultControllerCodeLength = 523;
static const JSC::Intrinsic s_readableStreamInternalsSetupReadableStreamDefaultControllerCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsSetupReadableStreamDefaultControllerCode = "(function (_,C,b,f,j,q,v){\"use strict\";const w=new @ReadableStreamDefaultController(_,C,b,f,@isReadableStream),x=()=>@promiseInvokeOrNoopMethod(C,q,[w]),B=(D)=>@promiseInvokeOrNoopMethod(C,v,[D]);@putByIdDirectPrivate(w,\"pullAlgorithm\",x),@putByIdDirectPrivate(w,\"cancelAlgorithm\",B),@putByIdDirectPrivate(w,\"pull\",@readableStreamDefaultControllerPull),@putByIdDirectPrivate(w,\"cancel\",@readableStreamDefaultControllerCancel),@putByIdDirectPrivate(_,\"readableStreamController\",w),@readableStreamDefaultControllerStart(w)})\n";

// createReadableStreamController
const JSC::ConstructAbility s_readableStreamInternalsCreateReadableStreamControllerCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsCreateReadableStreamControllerCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsCreateReadableStreamControllerCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsCreateReadableStreamControllerCodeLength = 671;
static const JSC::Intrinsic s_readableStreamInternalsCreateReadableStreamControllerCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsCreateReadableStreamControllerCode = "(function (b,A,D){\"use strict\";const _=A.type,f=@toString(_);if(f===\"bytes\"){if(D.highWaterMark===@undefined)D.highWaterMark=0;if(D.size!==@undefined)@throwRangeError(\"Strategy for a ReadableByteStreamController cannot have a size\");@putByIdDirectPrivate(b,\"readableStreamController\",new @ReadableByteStreamController(b,A,D.highWaterMark,@isReadableStream))}else if(f===\"direct\"){var j=D\?.highWaterMark;@initializeArrayBufferStream.@call(b,A,j)}else if(_===@undefined){if(D.highWaterMark===@undefined)D.highWaterMark=1;@setupReadableStreamDefaultController(b,A,D.size,D.highWaterMark,A.start,A.pull,A.cancel)}else @throwRangeError(\"Invalid type for underlying source\")})\n";

// readableStreamDefaultControllerStart
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamDefaultControllerStartCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamDefaultControllerStartCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamDefaultControllerStartCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamDefaultControllerStartCodeLength = 465;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamDefaultControllerStartCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamDefaultControllerStartCode = "(function (v){\"use strict\";if(@getByIdDirectPrivate(v,\"started\")!==-1)return;const a=@getByIdDirectPrivate(v,\"underlyingSource\"),b=a.start;@putByIdDirectPrivate(v,\"started\",0),@promiseInvokeOrNoopMethodNoCatch(a,b,[v]).@then(()=>{@putByIdDirectPrivate(v,\"started\",1),@assert(!@getByIdDirectPrivate(v,\"pulling\")),@assert(!@getByIdDirectPrivate(v,\"pullAgain\")),@readableStreamDefaultControllerCallPullIfNeeded(v)},(f)=>{@readableStreamDefaultControllerError(v,f)})})\n";

// readableStreamPipeToWritableStream
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamPipeToWritableStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamPipeToWritableStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamPipeToWritableStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamPipeToWritableStreamCodeLength = 1674;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamPipeToWritableStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamPipeToWritableStreamCode = "(function (_,z,B,I,f,k){\"use strict\";const q=!!@getByIdDirectPrivate(_,\"start\");if(@assert(@isReadableStream(_)),@assert(@isWritableStream(z)),@assert(!@isReadableStreamLocked(_)),@assert(!@isWritableStreamLocked(z)),@assert(k===@undefined||@isAbortSignal(k)),@getByIdDirectPrivate(_,\"underlyingByteSource\")!==@undefined)return @Promise.@reject(\"Piping to a readable bytestream is not supported\");let w={source:_,destination:z,preventAbort:I,preventCancel:f,preventClose:B,signal:k};if(w.reader=@acquireReadableStreamDefaultReader(_),w.writer=@acquireWritableStreamDefaultWriter(z),@putByIdDirectPrivate(_,\"disturbed\",!0),w.finalized=!1,w.shuttingDown=!1,w.promiseCapability=@newPromiseCapability(@Promise),w.pendingReadPromiseCapability=@newPromiseCapability(@Promise),w.pendingReadPromiseCapability.@resolve.@call(),w.pendingWritePromise=@Promise.@resolve(),k!==@undefined){const x=(E)=>{if(w.finalized)return;@pipeToShutdownWithAction(w,()=>{const G=!w.preventAbort&&@getByIdDirectPrivate(w.destination,\"state\")===\"writable\"\?@writableStreamAbort(w.destination,E):@Promise.@resolve(),J=!w.preventCancel&&@getByIdDirectPrivate(w.source,\"state\")===@streamReadable\?@readableStreamCancel(w.source,E):@Promise.@resolve();let K=@newPromiseCapability(@Promise),L=!0,M=()=>{if(L){L=!1;return}K.@resolve.@call()},N=(O)=>{K.@reject.@call(@undefined,O)};return G.@then(M,N),J.@then(M,N),K.@promise},E)};if(@whenSignalAborted(k,x))return w.promiseCapability.@promise}return @pipeToErrorsMustBePropagatedForward(w),@pipeToErrorsMustBePropagatedBackward(w),@pipeToClosingMustBePropagatedForward(w),@pipeToClosingMustBePropagatedBackward(w),@pipeToLoop(w),w.promiseCapability.@promise})\n";

// pipeToLoop
const JSC::ConstructAbility s_readableStreamInternalsPipeToLoopCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsPipeToLoopCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsPipeToLoopCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsPipeToLoopCodeLength = 110;
static const JSC::Intrinsic s_readableStreamInternalsPipeToLoopCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsPipeToLoopCode = "(function (d){\"use strict\";if(d.shuttingDown)return;@pipeToDoReadWrite(d).@then((n)=>{if(n)@pipeToLoop(d)})})\n";

// pipeToDoReadWrite
const JSC::ConstructAbility s_readableStreamInternalsPipeToDoReadWriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsPipeToDoReadWriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsPipeToDoReadWriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsPipeToDoReadWriteCodeLength = 731;
static const JSC::Intrinsic s_readableStreamInternalsPipeToDoReadWriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsPipeToDoReadWriteCode = "(function (_){\"use strict\";return @assert(!_.shuttingDown),_.pendingReadPromiseCapability=@newPromiseCapability(@Promise),@getByIdDirectPrivate(_.writer,\"readyPromise\").@promise.@then(()=>{if(_.shuttingDown){_.pendingReadPromiseCapability.@resolve.@call(@undefined,!1);return}@readableStreamDefaultReaderRead(_.reader).@then((d)=>{const h=!d.done&&@getByIdDirectPrivate(_.writer,\"stream\")!==@undefined;if(_.pendingReadPromiseCapability.@resolve.@call(@undefined,h),!h)return;_.pendingWritePromise=@writableStreamDefaultWriterWrite(_.writer,d.value)},(d)=>{_.pendingReadPromiseCapability.@resolve.@call(@undefined,!1)})},(d)=>{_.pendingReadPromiseCapability.@resolve.@call(@undefined,!1)}),_.pendingReadPromiseCapability.@promise})\n";

// pipeToErrorsMustBePropagatedForward
const JSC::ConstructAbility s_readableStreamInternalsPipeToErrorsMustBePropagatedForwardCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsPipeToErrorsMustBePropagatedForwardCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsPipeToErrorsMustBePropagatedForwardCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsPipeToErrorsMustBePropagatedForwardCodeLength = 438;
static const JSC::Intrinsic s_readableStreamInternalsPipeToErrorsMustBePropagatedForwardCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsPipeToErrorsMustBePropagatedForwardCode = "(function (c){\"use strict\";const d=()=>{c.pendingReadPromiseCapability.@resolve.@call(@undefined,!1);const _=@getByIdDirectPrivate(c.source,\"storedError\");if(!c.preventAbort){@pipeToShutdownWithAction(c,()=>@writableStreamAbort(c.destination,_),_);return}@pipeToShutdown(c,_)};if(@getByIdDirectPrivate(c.source,\"state\")===@streamErrored){d();return}@getByIdDirectPrivate(c.reader,\"closedPromiseCapability\").@promise.@then(@undefined,d)})\n";

// pipeToErrorsMustBePropagatedBackward
const JSC::ConstructAbility s_readableStreamInternalsPipeToErrorsMustBePropagatedBackwardCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsPipeToErrorsMustBePropagatedBackwardCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsPipeToErrorsMustBePropagatedBackwardCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsPipeToErrorsMustBePropagatedBackwardCodeLength = 369;
static const JSC::Intrinsic s_readableStreamInternalsPipeToErrorsMustBePropagatedBackwardCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsPipeToErrorsMustBePropagatedBackwardCode = "(function (d){\"use strict\";const _=()=>{const l=@getByIdDirectPrivate(d.destination,\"storedError\");if(!d.preventCancel){@pipeToShutdownWithAction(d,()=>@readableStreamCancel(d.source,l),l);return}@pipeToShutdown(d,l)};if(@getByIdDirectPrivate(d.destination,\"state\")===\"errored\"){_();return}@getByIdDirectPrivate(d.writer,\"closedPromise\").@promise.@then(@undefined,_)})\n";

// pipeToClosingMustBePropagatedForward
const JSC::ConstructAbility s_readableStreamInternalsPipeToClosingMustBePropagatedForwardCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsPipeToClosingMustBePropagatedForwardCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsPipeToClosingMustBePropagatedForwardCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsPipeToClosingMustBePropagatedForwardCodeLength = 459;
static const JSC::Intrinsic s_readableStreamInternalsPipeToClosingMustBePropagatedForwardCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsPipeToClosingMustBePropagatedForwardCode = "(function (r){\"use strict\";const _=()=>{r.pendingReadPromiseCapability.@resolve.@call(@undefined,!1);const d=@getByIdDirectPrivate(r.source,\"storedError\");if(!r.preventClose){@pipeToShutdownWithAction(r,()=>@writableStreamDefaultWriterCloseWithErrorPropagation(r.writer));return}@pipeToShutdown(r)};if(@getByIdDirectPrivate(r.source,\"state\")===@streamClosed){_();return}@getByIdDirectPrivate(r.reader,\"closedPromiseCapability\").@promise.@then(_,@undefined)})\n";

// pipeToClosingMustBePropagatedBackward
const JSC::ConstructAbility s_readableStreamInternalsPipeToClosingMustBePropagatedBackwardCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsPipeToClosingMustBePropagatedBackwardCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsPipeToClosingMustBePropagatedBackwardCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsPipeToClosingMustBePropagatedBackwardCodeLength = 324;
static const JSC::Intrinsic s_readableStreamInternalsPipeToClosingMustBePropagatedBackwardCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsPipeToClosingMustBePropagatedBackwardCode = "(function (d){\"use strict\";if(!@writableStreamCloseQueuedOrInFlight(d.destination)&&@getByIdDirectPrivate(d.destination,\"state\")!==\"closed\")return;const n=@makeTypeError(\"closing is propagated backward\");if(!d.preventCancel){@pipeToShutdownWithAction(d,()=>@readableStreamCancel(d.source,n),n);return}@pipeToShutdown(d,n)})\n";

// pipeToShutdownWithAction
const JSC::ConstructAbility s_readableStreamInternalsPipeToShutdownWithActionCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsPipeToShutdownWithActionCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsPipeToShutdownWithActionCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsPipeToShutdownWithActionCodeLength = 458;
static const JSC::Intrinsic s_readableStreamInternalsPipeToShutdownWithActionCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsPipeToShutdownWithActionCode = "(function (d,_){\"use strict\";if(d.shuttingDown)return;d.shuttingDown=!0;const u=arguments.length>2,C=arguments[2],D=()=>{_().@then(()=>{if(u)@pipeToFinalize(d,C);else @pipeToFinalize(d)},(g)=>{@pipeToFinalize(d,g)})};if(@getByIdDirectPrivate(d.destination,\"state\")===\"writable\"&&!@writableStreamCloseQueuedOrInFlight(d.destination)){d.pendingReadPromiseCapability.@promise.@then(()=>{d.pendingWritePromise.@then(D,D)},(b)=>@pipeToFinalize(d,b));return}D()})\n";

// pipeToShutdown
const JSC::ConstructAbility s_readableStreamInternalsPipeToShutdownCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsPipeToShutdownCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsPipeToShutdownCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsPipeToShutdownCodeLength = 411;
static const JSC::Intrinsic s_readableStreamInternalsPipeToShutdownCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsPipeToShutdownCode = "(function (d){\"use strict\";if(d.shuttingDown)return;d.shuttingDown=!0;const _=arguments.length>1,s=arguments[1],u=()=>{if(_)@pipeToFinalize(d,s);else @pipeToFinalize(d)};if(@getByIdDirectPrivate(d.destination,\"state\")===\"writable\"&&!@writableStreamCloseQueuedOrInFlight(d.destination)){d.pendingReadPromiseCapability.@promise.@then(()=>{d.pendingWritePromise.@then(u,u)},(w)=>@pipeToFinalize(d,w));return}u()})\n";

// pipeToFinalize
const JSC::ConstructAbility s_readableStreamInternalsPipeToFinalizeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsPipeToFinalizeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsPipeToFinalizeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsPipeToFinalizeCodeLength = 259;
static const JSC::Intrinsic s_readableStreamInternalsPipeToFinalizeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsPipeToFinalizeCode = "(function (_){\"use strict\";if(@writableStreamDefaultWriterRelease(_.writer),@readableStreamReaderGenericRelease(_.reader),_.finalized=!0,arguments.length>1)_.promiseCapability.@reject.@call(@undefined,arguments[1]);else _.promiseCapability.@resolve.@call()})\n";

// readableStreamTee
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamTeeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamTeeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamTeeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamTeeCodeLength = 1104;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamTeeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamTeeCode = "(function (v,f){\"use strict\";@assert(@isReadableStream(v)),@assert(typeof f===\"boolean\");var i=@getByIdDirectPrivate(v,\"start\");if(i)@putByIdDirectPrivate(v,\"start\",@undefined),i();const _=new @ReadableStreamDefaultReader(v),g={closedOrErrored:!1,canceled1:!1,canceled2:!1,reason1:@undefined,reason2:@undefined};g.cancelPromiseCapability=@newPromiseCapability(@Promise);const j=@readableStreamTeePullFunction(g,_,f),k={};@putByIdDirectPrivate(k,\"pull\",j),@putByIdDirectPrivate(k,\"cancel\",@readableStreamTeeBranch1CancelFunction(g,v));const q={};@putByIdDirectPrivate(q,\"pull\",j),@putByIdDirectPrivate(q,\"cancel\",@readableStreamTeeBranch2CancelFunction(g,v));const w=new @ReadableStream(k),x=new @ReadableStream(q);return @getByIdDirectPrivate(_,\"closedPromiseCapability\").@promise.@then(@undefined,function(y){if(g.closedOrErrored)return;if(@readableStreamDefaultControllerError(w.@readableStreamController,y),@readableStreamDefaultControllerError(x.@readableStreamController,y),g.closedOrErrored=!0,!g.canceled1||!g.canceled2)g.cancelPromiseCapability.@resolve.@call()}),g.branch1=w,g.branch2=x,[w,x]})\n";

// readableStreamTeePullFunction
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamTeePullFunctionCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamTeePullFunctionCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamTeePullFunctionCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamTeePullFunctionCodeLength = 764;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamTeePullFunctionCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamTeePullFunctionCode = "(function (c,n,_){\"use strict\";return function(){@Promise.prototype.@then.@call(@readableStreamDefaultReaderRead(n),function(i){if(@assert(@isObject(i)),@assert(typeof i.done===\"boolean\"),i.done&&!c.closedOrErrored){if(!c.canceled1)@readableStreamDefaultControllerClose(c.branch1.@readableStreamController);if(!c.canceled2)@readableStreamDefaultControllerClose(c.branch2.@readableStreamController);if(c.closedOrErrored=!0,!c.canceled1||!c.canceled2)c.cancelPromiseCapability.@resolve.@call()}if(c.closedOrErrored)return;if(!c.canceled1)@readableStreamDefaultControllerEnqueue(c.branch1.@readableStreamController,i.value);if(!c.canceled2)@readableStreamDefaultControllerEnqueue(c.branch2.@readableStreamController,_\?@structuredCloneForStream(i.value):i.value)})}})\n";

// readableStreamTeeBranch1CancelFunction
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamTeeBranch1CancelFunctionCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamTeeBranch1CancelFunctionCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamTeeBranch1CancelFunctionCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamTeeBranch1CancelFunctionCodeLength = 258;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamTeeBranch1CancelFunctionCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamTeeBranch1CancelFunctionCode = "(function (c,d){\"use strict\";return function(n){if(c.canceled1=!0,c.reason1=n,c.canceled2)@readableStreamCancel(d,[c.reason1,c.reason2]).@then(c.cancelPromiseCapability.@resolve,c.cancelPromiseCapability.@reject);return c.cancelPromiseCapability.@promise}})\n";

// readableStreamTeeBranch2CancelFunction
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamTeeBranch2CancelFunctionCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamTeeBranch2CancelFunctionCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamTeeBranch2CancelFunctionCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamTeeBranch2CancelFunctionCodeLength = 258;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamTeeBranch2CancelFunctionCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamTeeBranch2CancelFunctionCode = "(function (c,d){\"use strict\";return function(n){if(c.canceled2=!0,c.reason2=n,c.canceled1)@readableStreamCancel(d,[c.reason1,c.reason2]).@then(c.cancelPromiseCapability.@resolve,c.cancelPromiseCapability.@reject);return c.cancelPromiseCapability.@promise}})\n";

// isReadableStream
const JSC::ConstructAbility s_readableStreamInternalsIsReadableStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsIsReadableStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsIsReadableStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsIsReadableStreamCodeLength = 115;
static const JSC::Intrinsic s_readableStreamInternalsIsReadableStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsIsReadableStreamCode = "(function (n){\"use strict\";return @isObject(n)&&@getByIdDirectPrivate(n,\"readableStreamController\")!==@undefined})\n";

// isReadableStreamDefaultReader
const JSC::ConstructAbility s_readableStreamInternalsIsReadableStreamDefaultReaderCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsIsReadableStreamDefaultReaderCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsIsReadableStreamDefaultReaderCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsIsReadableStreamDefaultReaderCodeLength = 92;
static const JSC::Intrinsic s_readableStreamInternalsIsReadableStreamDefaultReaderCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsIsReadableStreamDefaultReaderCode = "(function (n){\"use strict\";return @isObject(n)&&!!@getByIdDirectPrivate(n,\"readRequests\")})\n";

// isReadableStreamDefaultController
const JSC::ConstructAbility s_readableStreamInternalsIsReadableStreamDefaultControllerCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsIsReadableStreamDefaultControllerCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsIsReadableStreamDefaultControllerCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsIsReadableStreamDefaultControllerCodeLength = 96;
static const JSC::Intrinsic s_readableStreamInternalsIsReadableStreamDefaultControllerCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsIsReadableStreamDefaultControllerCode = "(function (d){\"use strict\";return @isObject(d)&&!!@getByIdDirectPrivate(d,\"underlyingSource\")})\n";

// readDirectStream
const JSC::ConstructAbility s_readableStreamInternalsReadDirectStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadDirectStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadDirectStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadDirectStreamCodeLength = 900;
static const JSC::Intrinsic s_readableStreamInternalsReadDirectStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadDirectStreamCode = "(function (_,f,B){\"use strict\";@putByIdDirectPrivate(_,\"underlyingSource\",@undefined),@putByIdDirectPrivate(_,\"start\",@undefined);function I(q,v){if(v&&B\?.cancel){try{var w=B.cancel(v);@markPromiseAsHandled(w)}catch(x){}B=@undefined}if(q){if(@putByIdDirectPrivate(q,\"readableStreamController\",@undefined),@putByIdDirectPrivate(q,\"reader\",@undefined),v)@putByIdDirectPrivate(q,\"state\",@streamErrored),@putByIdDirectPrivate(q,\"storedError\",v);else @putByIdDirectPrivate(q,\"state\",@streamClosed);q=@undefined}}if(!B.pull){I();return}if(!@isCallable(B.pull)){I(),@throwTypeError(\"pull is not a function\");return}@putByIdDirectPrivate(_,\"readableStreamController\",f);const j=@getByIdDirectPrivate(_,\"highWaterMark\");f.start({highWaterMark:!j||j<64\?64:j}),@startDirectStream.@call(f,_,B.pull,I),@putByIdDirectPrivate(_,\"reader\",{});var p=B.pull(f);if(f=@undefined,p&&@isPromise(p))return p.@then(()=>{})})\n";

// assignToStream
const JSC::ConstructAbility s_readableStreamInternalsAssignToStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsAssignToStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsAssignToStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Private;
const int s_readableStreamInternalsAssignToStreamCodeLength = 221;
static const JSC::Intrinsic s_readableStreamInternalsAssignToStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsAssignToStreamCode = "(function (f,b){\"use strict\";var h=@getByIdDirectPrivate(f,\"underlyingSource\");if(h)try{return @readDirectStream(f,b,h)}catch(j){throw j}finally{h=@undefined,f=@undefined,b=@undefined}return @readStreamIntoSink(f,b,!0)})\n";

// readStreamIntoSink
const JSC::ConstructAbility s_readableStreamInternalsReadStreamIntoSinkCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadStreamIntoSinkCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadStreamIntoSinkCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadStreamIntoSinkCodeLength = 1395;
static const JSC::Intrinsic s_readableStreamInternalsReadStreamIntoSinkCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadStreamIntoSinkCode = "(async function (_,f,c){\"use strict\";var p=!1,B=!1;try{var P=_.getReader(),q=P.readMany();if(q&&@isPromise(q))q=await q;if(q.done)return p=!0,f.end();var x=q.value.length;const I=@getByIdDirectPrivate(_,\"highWaterMark\");if(c)@startDirectStream.@call(f,_,@undefined,()=>!B&&@markPromiseAsHandled(_.cancel()));f.start({highWaterMark:I||0});for(var z=0,A=q.value,D=q.value.length;z<D;z++)f.write(A[z]);var E=@getByIdDirectPrivate(_,\"state\");if(E===@streamClosed)return p=!0,f.end();while(!0){var{value:F,done:G}=await P.read();if(G)return p=!0,f.end();f.write(F)}}catch(I){B=!0;try{P=@undefined;const J=_.cancel(I);@markPromiseAsHandled(J)}catch(J){}if(f&&!p){p=!0;try{f.close(I)}catch(J){throw new globalThis.AggregateError([I,J])}}throw I}finally{if(P){try{P.releaseLock()}catch(J){}P=@undefined}f=@undefined;var E=@getByIdDirectPrivate(_,\"state\");if(_){var H=@getByIdDirectPrivate(_,\"readableStreamController\");if(H){if(@getByIdDirectPrivate(H,\"underlyingSource\"))@putByIdDirectPrivate(H,\"underlyingSource\",@undefined);if(@getByIdDirectPrivate(H,\"controlledReadableStream\"))@putByIdDirectPrivate(H,\"controlledReadableStream\",@undefined);if(@putByIdDirectPrivate(_,\"readableStreamController\",null),@getByIdDirectPrivate(_,\"underlyingSource\"))@putByIdDirectPrivate(_,\"underlyingSource\",@undefined);H=@undefined}if(!B&&E!==@streamClosed&&E!==@streamErrored)@readableStreamClose(_);_=@undefined}}})\n";

// handleDirectStreamError
const JSC::ConstructAbility s_readableStreamInternalsHandleDirectStreamErrorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsHandleDirectStreamErrorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsHandleDirectStreamErrorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsHandleDirectStreamErrorCodeLength = 496;
static const JSC::Intrinsic s_readableStreamInternalsHandleDirectStreamErrorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsHandleDirectStreamErrorCode = "(function (_){\"use strict\";var u=this,f=u.@sink;if(f){@putByIdDirectPrivate(u,\"sink\",@undefined);try{f.close(_)}catch(b){}}if(this.error=this.flush=this.write=this.close=this.end=@onReadableStreamDirectControllerClosed,typeof this.@underlyingSource.close===\"function\")try{this.@underlyingSource.close.@call(this.@underlyingSource,_)}catch(b){}try{var w=u._pendingRead;if(w)u._pendingRead=@undefined,@rejectPromise(w,_)}catch(b){}var a=u.@controlledReadableStream;if(a)@readableStreamError(a,_)})\n";

// handleDirectStreamErrorReject
const JSC::ConstructAbility s_readableStreamInternalsHandleDirectStreamErrorRejectCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsHandleDirectStreamErrorRejectCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsHandleDirectStreamErrorRejectCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsHandleDirectStreamErrorRejectCodeLength = 95;
static const JSC::Intrinsic s_readableStreamInternalsHandleDirectStreamErrorRejectCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsHandleDirectStreamErrorRejectCode = "(function (r){\"use strict\";return @handleDirectStreamError.@call(this,r),@Promise.@reject(r)})\n";

// onPullDirectStream
const JSC::ConstructAbility s_readableStreamInternalsOnPullDirectStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsOnPullDirectStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsOnPullDirectStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsOnPullDirectStreamCodeLength = 785;
static const JSC::Intrinsic s_readableStreamInternalsOnPullDirectStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsOnPullDirectStreamCode = "(function (_){\"use strict\";var i=_.@controlledReadableStream;if(!i||@getByIdDirectPrivate(i,\"state\")!==@streamReadable)return;if(_._deferClose===-1)return;_._deferClose=-1,_._deferFlush=-1;var y,d;try{var E=_.@underlyingSource.pull(_);if(E&&@isPromise(E)){if(_._handleError===@undefined)_._handleError=@handleDirectStreamErrorReject.bind(_);@Promise.prototype.catch.@call(E,_._handleError)}}catch(j){return @handleDirectStreamErrorReject.@call(_,j)}finally{y=_._deferClose,d=_._deferFlush,_._deferFlush=_._deferClose=0}var b;if(_._pendingRead===@undefined)_._pendingRead=b=@newPromise();else b=@readableStreamAddReadRequest(i);if(y===1){var g=_._deferCloseReason;return _._deferCloseReason=@undefined,@onCloseDirectStream.@call(_,g),b}if(d===1)@onFlushDirectStream.@call(_);return b})\n";

// noopDoneFunction
const JSC::ConstructAbility s_readableStreamInternalsNoopDoneFunctionCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsNoopDoneFunctionCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsNoopDoneFunctionCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsNoopDoneFunctionCodeLength = 81;
static const JSC::Intrinsic s_readableStreamInternalsNoopDoneFunctionCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsNoopDoneFunctionCode = "(function (){\"use strict\";return @Promise.@resolve({value:@undefined,done:!0})})\n";

// onReadableStreamDirectControllerClosed
const JSC::ConstructAbility s_readableStreamInternalsOnReadableStreamDirectControllerClosedCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsOnReadableStreamDirectControllerClosedCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsOnReadableStreamDirectControllerClosedCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsOnReadableStreamDirectControllerClosedCodeLength = 93;
static const JSC::Intrinsic s_readableStreamInternalsOnReadableStreamDirectControllerClosedCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsOnReadableStreamDirectControllerClosedCode = "(function (d){\"use strict\";@throwTypeError(\"ReadableStreamDirectController is now closed\")})\n";

// onCloseDirectStream
const JSC::ConstructAbility s_readableStreamInternalsOnCloseDirectStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsOnCloseDirectStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsOnCloseDirectStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsOnCloseDirectStreamCodeLength = 1460;
static const JSC::Intrinsic s_readableStreamInternalsOnCloseDirectStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsOnCloseDirectStreamCode = "(function (c){\"use strict\";var i=this.@controlledReadableStream;if(!i||@getByIdDirectPrivate(i,\"state\")!==@streamReadable)return;if(this._deferClose!==0){this._deferClose=1,this._deferCloseReason=c;return}if(@putByIdDirectPrivate(i,\"state\",@streamClosing),typeof this.@underlyingSource.close===\"function\")try{this.@underlyingSource.close.@call(this.@underlyingSource,c)}catch(b){}var v;try{v=this.@sink.end(),@putByIdDirectPrivate(this,\"sink\",@undefined)}catch(b){if(this._pendingRead){var _=this._pendingRead;this._pendingRead=@undefined,@rejectPromise(_,b)}@readableStreamError(i,b);return}this.error=this.flush=this.write=this.close=this.end=@onReadableStreamDirectControllerClosed;var C=@getByIdDirectPrivate(i,\"reader\");if(C&&@isReadableStreamDefaultReader(C)){var N=this._pendingRead;if(N&&@isPromise(N)&&v\?.byteLength){this._pendingRead=@undefined,@fulfillPromise(N,{value:v,done:!1}),@readableStreamClose(i);return}}if(v\?.byteLength){var P=@getByIdDirectPrivate(C,\"readRequests\");if(P\?.isNotEmpty()){@readableStreamFulfillReadRequest(i,v,!1),@readableStreamClose(i);return}@putByIdDirectPrivate(i,\"state\",@streamReadable),this.@pull=()=>{var b=@createFulfilledPromise({value:v,done:!1});return v=@undefined,@readableStreamClose(i),i=@undefined,b}}else if(this._pendingRead){var _=this._pendingRead;this._pendingRead=@undefined,@putByIdDirectPrivate(this,\"pull\",@noopDoneFunction),@fulfillPromise(_,{value:@undefined,done:!0})}@readableStreamClose(i)})\n";

// onFlushDirectStream
const JSC::ConstructAbility s_readableStreamInternalsOnFlushDirectStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsOnFlushDirectStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsOnFlushDirectStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsOnFlushDirectStreamCodeLength = 591;
static const JSC::Intrinsic s_readableStreamInternalsOnFlushDirectStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsOnFlushDirectStreamCode = "(function (){\"use strict\";var c=this.@controlledReadableStream,o=@getByIdDirectPrivate(c,\"reader\");if(!o||!@isReadableStreamDefaultReader(o))return;var D=this._pendingRead;if(this._pendingRead=@undefined,D&&@isPromise(D)){var b=this.@sink.flush();if(b\?.byteLength)this._pendingRead=@getByIdDirectPrivate(c,\"readRequests\")\?.shift(),@fulfillPromise(D,{value:b,done:!1});else this._pendingRead=D}else if(@getByIdDirectPrivate(c,\"readRequests\")\?.isNotEmpty()){var b=this.@sink.flush();if(b\?.byteLength)@readableStreamFulfillReadRequest(c,b,!1)}else if(this._deferFlush===-1)this._deferFlush=1})\n";

// createTextStream
const JSC::ConstructAbility s_readableStreamInternalsCreateTextStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsCreateTextStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsCreateTextStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsCreateTextStreamCodeLength = 984;
static const JSC::Intrinsic s_readableStreamInternalsCreateTextStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsCreateTextStreamCode = "(function (_){\"use strict\";var w,j=[],q=!1,v=!1,x=\"\",z=@toLength(0),A=@newPromiseCapability(@Promise),C=!1;return w={start(){},write(E){if(typeof E===\"string\"){var F=@toLength(E.length);if(F>0)x+=E,q=!0,z+=F;return F}if(!E||!(@ArrayBuffer.@isView(E)||E instanceof @ArrayBuffer))@throwTypeError(\"Expected text, ArrayBuffer or ArrayBufferView\");const G=@toLength(E.byteLength);if(G>0)if(v=!0,x.length>0)@arrayPush(j,x,E),x=\"\";else @arrayPush(j,E);return z+=G,G},flush(){return 0},end(){if(C)return\"\";return w.fulfill()},fulfill(){C=!0;const E=w.finishInternal();return @fulfillPromise(A.@promise,E),E},finishInternal(){if(!q&&!v)return\"\";if(q&&!v)return x;if(v&&!q)return new globalThis.TextDecoder().decode(@Bun.concatArrayBuffers(j));var E=new @Bun.ArrayBufferSink;E.start({highWaterMark:z,asUint8Array:!0});for(let F of j)E.write(F);if(j.length=0,x.length>0)E.write(x),x=\"\";return new globalThis.TextDecoder().decode(E.end())},close(){try{if(!C)C=!0,w.fulfill()}catch(E){}}},[w,A]})\n";

// initializeTextStream
const JSC::ConstructAbility s_readableStreamInternalsInitializeTextStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsInitializeTextStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsInitializeTextStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsInitializeTextStreamCodeLength = 578;
static const JSC::Intrinsic s_readableStreamInternalsInitializeTextStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsInitializeTextStreamCode = "(function (_,d){\"use strict\";var[p,D]=@createTextStream(d),b={@underlyingSource:_,@pull:@onPullDirectStream,@controlledReadableStream:this,@sink:p,close:@onCloseDirectStream,write:p.write,error:@handleDirectStreamError,end:@onCloseDirectStream,@close:@onCloseDirectStream,flush:@onFlushDirectStream,_pendingRead:@undefined,_deferClose:0,_deferFlush:0,_deferCloseReason:@undefined,_handleError:@undefined};return @putByIdDirectPrivate(this,\"readableStreamController\",b),@putByIdDirectPrivate(this,\"underlyingSource\",@undefined),@putByIdDirectPrivate(this,\"start\",@undefined),D})\n";

// initializeArrayStream
const JSC::ConstructAbility s_readableStreamInternalsInitializeArrayStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsInitializeArrayStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsInitializeArrayStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsInitializeArrayStreamCodeLength = 797;
static const JSC::Intrinsic s_readableStreamInternalsInitializeArrayStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsInitializeArrayStreamCode = "(function (_,p){\"use strict\";var t=[],C=@newPromiseCapability(@Promise),b=!1;function j(){return b=!0,C.@resolve.@call(@undefined,t),t}var q={start(){},write(w){return @arrayPush(t,w),w.byteLength||w.length},flush(){return 0},end(){if(b)return[];return j()},close(){if(!b)j()}},v={@underlyingSource:_,@pull:@onPullDirectStream,@controlledReadableStream:this,@sink:q,close:@onCloseDirectStream,write:q.write,error:@handleDirectStreamError,end:@onCloseDirectStream,@close:@onCloseDirectStream,flush:@onFlushDirectStream,_pendingRead:@undefined,_deferClose:0,_deferFlush:0,_deferCloseReason:@undefined,_handleError:@undefined};return @putByIdDirectPrivate(this,\"readableStreamController\",v),@putByIdDirectPrivate(this,\"underlyingSource\",@undefined),@putByIdDirectPrivate(this,\"start\",@undefined),C})\n";

// initializeArrayBufferStream
const JSC::ConstructAbility s_readableStreamInternalsInitializeArrayBufferStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsInitializeArrayBufferStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsInitializeArrayBufferStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsInitializeArrayBufferStreamCodeLength = 690;
static const JSC::Intrinsic s_readableStreamInternalsInitializeArrayBufferStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsInitializeArrayBufferStreamCode = "(function (_,d){\"use strict\";var b=d&&typeof d===\"number\"\?{highWaterMark:d,stream:!0,asUint8Array:!0}:{stream:!0,asUint8Array:!0},f=new @Bun.ArrayBufferSink;f.start(b);var D={@underlyingSource:_,@pull:@onPullDirectStream,@controlledReadableStream:this,@sink:f,close:@onCloseDirectStream,write:f.write.bind(f),error:@handleDirectStreamError,end:@onCloseDirectStream,@close:@onCloseDirectStream,flush:@onFlushDirectStream,_pendingRead:@undefined,_deferClose:0,_deferFlush:0,_deferCloseReason:@undefined,_handleError:@undefined};@putByIdDirectPrivate(this,\"readableStreamController\",D),@putByIdDirectPrivate(this,\"underlyingSource\",@undefined),@putByIdDirectPrivate(this,\"start\",@undefined)})\n";

// readableStreamError
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamErrorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamErrorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamErrorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamErrorCodeLength = 840;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamErrorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamErrorCode = "(function (n,_){\"use strict\";@assert(@isReadableStream(n)),@assert(@getByIdDirectPrivate(n,\"state\")===@streamReadable),@putByIdDirectPrivate(n,\"state\",@streamErrored),@putByIdDirectPrivate(n,\"storedError\",_);const c=@getByIdDirectPrivate(n,\"reader\");if(!c)return;if(@isReadableStreamDefaultReader(c)){const b=@getByIdDirectPrivate(c,\"readRequests\");@putByIdDirectPrivate(c,\"readRequests\",@createFIFO());for(var i=b.shift();i;i=b.shift())@rejectPromise(i,_)}else{@assert(@isReadableStreamBYOBReader(c));const b=@getByIdDirectPrivate(c,\"readIntoRequests\");@putByIdDirectPrivate(c,\"readIntoRequests\",@createFIFO());for(var i=b.shift();i;i=b.shift())@rejectPromise(i,_)}@getByIdDirectPrivate(c,\"closedPromiseCapability\").@reject.@call(@undefined,_);const l=@getByIdDirectPrivate(c,\"closedPromiseCapability\").@promise;@markPromiseAsHandled(l)})\n";

// readableStreamDefaultControllerShouldCallPull
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamDefaultControllerShouldCallPullCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamDefaultControllerShouldCallPullCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamDefaultControllerShouldCallPullCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamDefaultControllerShouldCallPullCodeLength = 477;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamDefaultControllerShouldCallPullCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamDefaultControllerShouldCallPullCode = "(function (_){\"use strict\";const p=@getByIdDirectPrivate(_,\"controlledReadableStream\");if(!@readableStreamDefaultControllerCanCloseOrEnqueue(_))return!1;if(@getByIdDirectPrivate(_,\"started\")!==1)return!1;if((!@isReadableStreamLocked(p)||!@getByIdDirectPrivate(@getByIdDirectPrivate(p,\"reader\"),\"readRequests\")\?.isNotEmpty())&&@readableStreamDefaultControllerGetDesiredSize(_)<=0)return!1;const u=@readableStreamDefaultControllerGetDesiredSize(_);return @assert(u!==null),u>0})\n";

// readableStreamDefaultControllerCallPullIfNeeded
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamDefaultControllerCallPullIfNeededCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamDefaultControllerCallPullIfNeededCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamDefaultControllerCallPullIfNeededCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamDefaultControllerCallPullIfNeededCodeLength = 859;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamDefaultControllerCallPullIfNeededCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamDefaultControllerCallPullIfNeededCode = "(function (_){\"use strict\";const d=@getByIdDirectPrivate(_,\"controlledReadableStream\");if(!@readableStreamDefaultControllerCanCloseOrEnqueue(_))return;if(@getByIdDirectPrivate(_,\"started\")!==1)return;if((!@isReadableStreamLocked(d)||!@getByIdDirectPrivate(@getByIdDirectPrivate(d,\"reader\"),\"readRequests\")\?.isNotEmpty())&&@readableStreamDefaultControllerGetDesiredSize(_)<=0)return;if(@getByIdDirectPrivate(_,\"pulling\")){@putByIdDirectPrivate(_,\"pullAgain\",!0);return}@assert(!@getByIdDirectPrivate(_,\"pullAgain\")),@putByIdDirectPrivate(_,\"pulling\",!0),@getByIdDirectPrivate(_,\"pullAlgorithm\").@call(@undefined).@then(function(){if(@putByIdDirectPrivate(_,\"pulling\",!1),@getByIdDirectPrivate(_,\"pullAgain\"))@putByIdDirectPrivate(_,\"pullAgain\",!1),@readableStreamDefaultControllerCallPullIfNeeded(_)},function(a){@readableStreamDefaultControllerError(_,a)})})\n";

// isReadableStreamLocked
const JSC::ConstructAbility s_readableStreamInternalsIsReadableStreamLockedCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsIsReadableStreamLockedCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsIsReadableStreamLockedCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsIsReadableStreamLockedCodeLength = 102;
static const JSC::Intrinsic s_readableStreamInternalsIsReadableStreamLockedCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsIsReadableStreamLockedCode = "(function (d){\"use strict\";return @assert(@isReadableStream(d)),!!@getByIdDirectPrivate(d,\"reader\")})\n";

// readableStreamDefaultControllerGetDesiredSize
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamDefaultControllerGetDesiredSizeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamDefaultControllerGetDesiredSizeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamDefaultControllerGetDesiredSizeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamDefaultControllerGetDesiredSizeCodeLength = 283;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamDefaultControllerGetDesiredSizeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamDefaultControllerGetDesiredSizeCode = "(function (d){\"use strict\";const i=@getByIdDirectPrivate(d,\"controlledReadableStream\"),y=@getByIdDirectPrivate(i,\"state\");if(y===@streamErrored)return null;if(y===@streamClosed)return 0;return @getByIdDirectPrivate(d,\"strategy\").highWaterMark-@getByIdDirectPrivate(d,\"queue\").size})\n";

// readableStreamReaderGenericCancel
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamReaderGenericCancelCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamReaderGenericCancelCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamReaderGenericCancelCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamReaderGenericCancelCodeLength = 133;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamReaderGenericCancelCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamReaderGenericCancelCode = "(function (_,c){\"use strict\";const p=@getByIdDirectPrivate(_,\"ownerReadableStream\");return @assert(!!p),@readableStreamCancel(p,c)})\n";

// readableStreamCancel
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamCancelCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamCancelCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamCancelCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamCancelCodeLength = 509;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamCancelCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamCancelCode = "(function (i,_){\"use strict\";@putByIdDirectPrivate(i,\"disturbed\",!0);const d=@getByIdDirectPrivate(i,\"state\");if(d===@streamClosed)return @Promise.@resolve();if(d===@streamErrored)return @Promise.@reject(@getByIdDirectPrivate(i,\"storedError\"));@readableStreamClose(i);var u=@getByIdDirectPrivate(i,\"readableStreamController\"),f=u.@cancel;if(f)return f(u,_).@then(function(){});var p=u.close;if(p)return @Promise.@resolve(u.close(_));@throwTypeError(\"ReadableStreamController has no cancel or close method\")})\n";

// readableStreamDefaultControllerCancel
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamDefaultControllerCancelCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamDefaultControllerCancelCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamDefaultControllerCancelCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamDefaultControllerCancelCodeLength = 146;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamDefaultControllerCancelCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamDefaultControllerCancelCode = "(function (d,_){\"use strict\";return @putByIdDirectPrivate(d,\"queue\",@newQueue()),@getByIdDirectPrivate(d,\"cancelAlgorithm\").@call(@undefined,_)})\n";

// readableStreamDefaultControllerPull
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamDefaultControllerPullCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamDefaultControllerPullCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamDefaultControllerPullCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamDefaultControllerPullCodeLength = 519;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamDefaultControllerPullCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamDefaultControllerPullCode = "(function (_){\"use strict\";var a=@getByIdDirectPrivate(_,\"queue\");if(a.content.isNotEmpty()){const i=@dequeueValue(a);if(@getByIdDirectPrivate(_,\"closeRequested\")&&a.content.isEmpty())@readableStreamClose(@getByIdDirectPrivate(_,\"controlledReadableStream\"));else @readableStreamDefaultControllerCallPullIfNeeded(_);return @createFulfilledPromise({value:i,done:!1})}const d=@readableStreamAddReadRequest(@getByIdDirectPrivate(_,\"controlledReadableStream\"));return @readableStreamDefaultControllerCallPullIfNeeded(_),d})\n";

// readableStreamDefaultControllerClose
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamDefaultControllerCloseCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamDefaultControllerCloseCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamDefaultControllerCloseCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamDefaultControllerCloseCodeLength = 266;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamDefaultControllerCloseCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamDefaultControllerCloseCode = "(function (a){\"use strict\";if(@assert(@readableStreamDefaultControllerCanCloseOrEnqueue(a)),@putByIdDirectPrivate(a,\"closeRequested\",!0),@getByIdDirectPrivate(a,\"queue\")\?.content\?.isEmpty())@readableStreamClose(@getByIdDirectPrivate(a,\"controlledReadableStream\"))})\n";

// readableStreamClose
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamCloseCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamCloseCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamCloseCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamCloseCodeLength = 617;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamCloseCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamCloseCode = "(function (i){\"use strict\";if(@assert(@getByIdDirectPrivate(i,\"state\")===@streamReadable),@putByIdDirectPrivate(i,\"state\",@streamClosed),!@getByIdDirectPrivate(i,\"reader\"))return;if(@isReadableStreamDefaultReader(@getByIdDirectPrivate(i,\"reader\"))){const c=@getByIdDirectPrivate(@getByIdDirectPrivate(i,\"reader\"),\"readRequests\");if(c.isNotEmpty()){@putByIdDirectPrivate(@getByIdDirectPrivate(i,\"reader\"),\"readRequests\",@createFIFO());for(var _=c.shift();_;_=c.shift())@fulfillPromise(_,{value:@undefined,done:!0})}}@getByIdDirectPrivate(@getByIdDirectPrivate(i,\"reader\"),\"closedPromiseCapability\").@resolve.@call()})\n";

// readableStreamFulfillReadRequest
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamFulfillReadRequestCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamFulfillReadRequestCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamFulfillReadRequestCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamFulfillReadRequestCodeLength = 157;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamFulfillReadRequestCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamFulfillReadRequestCode = "(function (i,p,r){\"use strict\";const _=@getByIdDirectPrivate(@getByIdDirectPrivate(i,\"reader\"),\"readRequests\").shift();@fulfillPromise(_,{value:p,done:r})})\n";

// readableStreamDefaultControllerEnqueue
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamDefaultControllerEnqueueCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamDefaultControllerEnqueueCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamDefaultControllerEnqueueCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamDefaultControllerEnqueueCodeLength = 659;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamDefaultControllerEnqueueCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamDefaultControllerEnqueueCode = "(function (d,y){\"use strict\";const a=@getByIdDirectPrivate(d,\"controlledReadableStream\");if(@assert(@readableStreamDefaultControllerCanCloseOrEnqueue(d)),@isReadableStreamLocked(a)&&@getByIdDirectPrivate(@getByIdDirectPrivate(a,\"reader\"),\"readRequests\")\?.isNotEmpty()){@readableStreamFulfillReadRequest(a,y,!1),@readableStreamDefaultControllerCallPullIfNeeded(d);return}try{let b=1;if(@getByIdDirectPrivate(d,\"strategy\").size!==@undefined)b=@getByIdDirectPrivate(d,\"strategy\").size(y);@enqueueValueWithSize(@getByIdDirectPrivate(d,\"queue\"),y,b)}catch(b){throw @readableStreamDefaultControllerError(d,b),b}@readableStreamDefaultControllerCallPullIfNeeded(d)})\n";

// readableStreamDefaultReaderRead
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamDefaultReaderReadCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamDefaultReaderReadCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamDefaultReaderReadCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamDefaultReaderReadCodeLength = 491;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamDefaultReaderReadCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamDefaultReaderReadCode = "(function (n){\"use strict\";const i=@getByIdDirectPrivate(n,\"ownerReadableStream\");@assert(!!i);const v=@getByIdDirectPrivate(i,\"state\");if(@putByIdDirectPrivate(i,\"disturbed\",!0),v===@streamClosed)return @createFulfilledPromise({value:@undefined,done:!0});if(v===@streamErrored)return @Promise.@reject(@getByIdDirectPrivate(i,\"storedError\"));return @assert(v===@streamReadable),@getByIdDirectPrivate(i,\"readableStreamController\").@pull(@getByIdDirectPrivate(i,\"readableStreamController\"))})\n";

// readableStreamAddReadRequest
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamAddReadRequestCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamAddReadRequestCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamAddReadRequestCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamAddReadRequestCodeLength = 274;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamAddReadRequestCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamAddReadRequestCode = "(function (c){\"use strict\";@assert(@isReadableStreamDefaultReader(@getByIdDirectPrivate(c,\"reader\"))),@assert(@getByIdDirectPrivate(c,\"state\")==@streamReadable);const i=@newPromise();return @getByIdDirectPrivate(@getByIdDirectPrivate(c,\"reader\"),\"readRequests\").push(i),i})\n";

// isReadableStreamDisturbed
const JSC::ConstructAbility s_readableStreamInternalsIsReadableStreamDisturbedCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsIsReadableStreamDisturbedCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsIsReadableStreamDisturbedCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsIsReadableStreamDisturbedCodeLength = 103;
static const JSC::Intrinsic s_readableStreamInternalsIsReadableStreamDisturbedCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsIsReadableStreamDisturbedCode = "(function (d){\"use strict\";return @assert(@isReadableStream(d)),@getByIdDirectPrivate(d,\"disturbed\")})\n";

// readableStreamReaderGenericRelease
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamReaderGenericReleaseCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamReaderGenericReleaseCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamReaderGenericReleaseCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamReaderGenericReleaseCodeLength = 813;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamReaderGenericReleaseCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamReaderGenericReleaseCode = "(function (n){\"use strict\";if(@assert(!!@getByIdDirectPrivate(n,\"ownerReadableStream\")),@assert(@getByIdDirectPrivate(@getByIdDirectPrivate(n,\"ownerReadableStream\"),\"reader\")===n),@getByIdDirectPrivate(@getByIdDirectPrivate(n,\"ownerReadableStream\"),\"state\")===@streamReadable)@getByIdDirectPrivate(n,\"closedPromiseCapability\").@reject.@call(@undefined,@makeTypeError(\"releasing lock of reader whose stream is still in readable state\"));else @putByIdDirectPrivate(n,\"closedPromiseCapability\",{@promise:@newHandledRejectedPromise(@makeTypeError(\"reader released lock\"))});const _=@getByIdDirectPrivate(n,\"closedPromiseCapability\").@promise;@markPromiseAsHandled(_),@putByIdDirectPrivate(@getByIdDirectPrivate(n,\"ownerReadableStream\"),\"reader\",@undefined),@putByIdDirectPrivate(n,\"ownerReadableStream\",@undefined)})\n";

// readableStreamDefaultControllerCanCloseOrEnqueue
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamDefaultControllerCanCloseOrEnqueueCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamDefaultControllerCanCloseOrEnqueueCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamDefaultControllerCanCloseOrEnqueueCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamDefaultControllerCanCloseOrEnqueueCodeLength = 180;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamDefaultControllerCanCloseOrEnqueueCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamDefaultControllerCanCloseOrEnqueueCode = "(function (a){\"use strict\";return!@getByIdDirectPrivate(a,\"closeRequested\")&&@getByIdDirectPrivate(@getByIdDirectPrivate(a,\"controlledReadableStream\"),\"state\")===@streamReadable})\n";

// lazyLoadStream
const JSC::ConstructAbility s_readableStreamInternalsLazyLoadStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsLazyLoadStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsLazyLoadStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsLazyLoadStreamCodeLength = 1589;
static const JSC::Intrinsic s_readableStreamInternalsLazyLoadStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsLazyLoadStreamCode = "(function (b,f){\"use strict\";var j=@getByIdDirectPrivate(b,\"bunNativeType\"),m=@getByIdDirectPrivate(b,\"bunNativePtr\"),q=@lazyStreamPrototypeMap.@get(j);if(q===@undefined){let U=function(Z){var{c:_,v:p}=this;this.c=@undefined,this.v=@undefined,J(Z,_,p)},W=function(Z){try{Z.close()}catch(_){globalThis.reportError(_)}},X=function(Z,_,p,z){z[0]=!1;var A;try{A=x(Z,p,z)}catch(C){return _.error(C)}return J(A,_,p)};var Q=U,P=W,O=X,[x,B,D,E,F,G,H]=@lazyLoad(j),I=[!1],J;J=function Z(_,p,z){if(_&&@isPromise(_))return _.then(U.bind({c:p,v:z}),(A)=>p.error(A));else if(typeof _===\"number\")if(z&&z.byteLength===_&&z.buffer===p.byobRequest\?.view\?.buffer)p.byobRequest.respondWithNewView(z);else p.byobRequest.respond(_);else if(_.constructor===@Uint8Array)p.enqueue(_);if(I[0]||_===!1)@enqueueJob(W,p),I[0]=!1};const Y=F\?new FinalizationRegistry(F):null;q=class Z{constructor(_,p,z){if(this.#f=_,this.#b={},this.pull=this.#j.bind(this),this.cancel=this.#m.bind(this),this.autoAllocateChunkSize=p,z!==@undefined)this.start=(A)=>{A.enqueue(z)};if(Y)Y.register(this,_,this.#b)}#b;pull;cancel;start;#f;type=\"bytes\";autoAllocateChunkSize=0;static startSync=B;#j(_){var p=this.#f;if(!p){_.close();return}X(p,_,_.byobRequest.view,I)}#m(_){var p=this.#f;Y&&Y.unregister(this.#b),G&&G(p,!1),D(p,_)}static deinit=F;static drain=H},@lazyStreamPrototypeMap.@set(j,q)}const K=q.startSync(m,f);var L;const{drain:M,deinit:N}=q;if(M)L=M(m);if(K===0){if(F&&m&&@enqueueJob(F,m),(L\?.byteLength\?\?0)>0)return{start(U){U.enqueue(L),U.close()},type:\"bytes\"};return{start(U){U.close()},type:\"bytes\"}}return new q(m,K,L)})\n";

// readableStreamIntoArray
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamIntoArrayCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamIntoArrayCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamIntoArrayCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamIntoArrayCodeLength = 247;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamIntoArrayCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamIntoArrayCode = "(function (_){\"use strict\";var b=_.getReader(),d=b.readMany();async function f(g){if(g.done)return[];var j=g.value||[];while(!0){var q=await b.read();if(q.done)break;j=j.concat(q.value)}return j}if(d&&@isPromise(d))return d.@then(f);return f(d)})\n";

// readableStreamIntoText
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamIntoTextCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamIntoTextCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamIntoTextCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamIntoTextCodeLength = 214;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamIntoTextCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamIntoTextCode = "(function (i){\"use strict\";const[d,n]=@createTextStream(@getByIdDirectPrivate(i,\"highWaterMark\")),b=@readStreamIntoSink(i,d,!1);if(b&&@isPromise(b))return @Promise.@resolve(b).@then(n.@promise);return n.@promise})\n";

// readableStreamToArrayBufferDirect
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamToArrayBufferDirectCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamToArrayBufferDirectCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamToArrayBufferDirectCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamToArrayBufferDirectCodeLength = 727;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamToArrayBufferDirectCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamToArrayBufferDirectCode = "(function (B,_){\"use strict\";var j=new @Bun.ArrayBufferSink;@putByIdDirectPrivate(B,\"underlyingSource\",@undefined);var q=@getByIdDirectPrivate(B,\"highWaterMark\");j.start(q\?{highWaterMark:q}:{});var v=@newPromiseCapability(@Promise),w=!1,x=_.pull,z=_.close,A={start(){},close(D){if(!w){if(w=!0,z)z();@fulfillPromise(v.@promise,j.end())}},end(){if(!w){if(w=!0,z)z();@fulfillPromise(v.@promise,j.end())}},flush(){return 0},write:j.write.bind(j)},C=!1;try{const D=x(A);if(D&&@isObject(D)&&@isPromise(D))return async function(F,G,H){while(!w)await H(F);return await G}(A,promise,x);return v.@promise}catch(D){return C=!0,@readableStreamError(B,D),@Promise.@reject(D)}finally{if(!C&&B)@readableStreamClose(B);A=z=j=x=B=@undefined}})\n";

// readableStreamToTextDirect
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamToTextDirectCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamToTextDirectCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamToTextDirectCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamToTextDirectCodeLength = 278;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamToTextDirectCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamToTextDirectCode = "(async function (_,p){\"use strict\";const c=@initializeTextStream.@call(_,p,@undefined);var f=_.getReader();while(@getByIdDirectPrivate(_,\"state\")===@streamReadable){var j=await f.read();if(j.done)break}try{f.releaseLock()}catch(k){}return f=@undefined,_=@undefined,c.@promise})\n";

// readableStreamToArrayDirect
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamToArrayDirectCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamToArrayDirectCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamToArrayDirectCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamToArrayDirectCodeLength = 371;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamToArrayDirectCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamToArrayDirectCode = "(async function (_,f){\"use strict\";const j=@initializeArrayStream.@call(_,f,@undefined);f=@undefined;var k=_.getReader();try{while(@getByIdDirectPrivate(_,\"state\")===@streamReadable){var q=await k.read();if(q.done)break}try{k.releaseLock()}catch(v){}return k=@undefined,@Promise.@resolve(j.@promise)}catch(v){throw v}finally{_=@undefined,k=@undefined}return j.@promise})\n";

// readableStreamDefineLazyIterators
const JSC::ConstructAbility s_readableStreamInternalsReadableStreamDefineLazyIteratorsCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInternalsReadableStreamDefineLazyIteratorsCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInternalsReadableStreamDefineLazyIteratorsCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInternalsReadableStreamDefineLazyIteratorsCodeLength = 516;
static const JSC::Intrinsic s_readableStreamInternalsReadableStreamDefineLazyIteratorsCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInternalsReadableStreamDefineLazyIteratorsCode = "(function (_){\"use strict\";var w=globalThis.Symbol.asyncIterator,g=async function*k(q,x){var z=q.getReader(),B;try{while(!0){var D,F;const G=z.readMany();if(@isPromise(G))({done:D,value:F}=await G);else({done:D,value:F}=G);if(D)return;yield*F}}catch(G){B=G}finally{if(z.releaseLock(),!x)q.cancel(B);if(B)throw B}},h=function k(){return g(this,!1)},j=function k({preventCancel:q=!1}={preventCancel:!1}){return g(this,q)};return @Object.@defineProperty(_,w,{value:h}),@Object.@defineProperty(_,\"values\",{value:j}),_})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().readableStreamInternalsBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().readableStreamInternalsBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_READABLESTREAMINTERNALS_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* TransformStreamDefaultController.ts */
// initializeTransformStreamDefaultController
const JSC::ConstructAbility s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCodeLength = 40;
static const JSC::Intrinsic s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCode = "(function (){\"use strict\";return this})\n";

// desiredSize
const JSC::ConstructAbility s_transformStreamDefaultControllerDesiredSizeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamDefaultControllerDesiredSizeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamDefaultControllerDesiredSizeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamDefaultControllerDesiredSizeCodeLength = 339;
static const JSC::Intrinsic s_transformStreamDefaultControllerDesiredSizeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamDefaultControllerDesiredSizeCode = "(function (){\"use strict\";if(!@isTransformStreamDefaultController(this))throw @makeThisTypeError(\"TransformStreamDefaultController\",\"enqueue\");const u=@getByIdDirectPrivate(this,\"stream\"),i=@getByIdDirectPrivate(u,\"readable\"),w=@getByIdDirectPrivate(i,\"readableStreamController\");return @readableStreamDefaultControllerGetDesiredSize(w)})\n";

// enqueue
const JSC::ConstructAbility s_transformStreamDefaultControllerEnqueueCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamDefaultControllerEnqueueCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamDefaultControllerEnqueueCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamDefaultControllerEnqueueCodeLength = 195;
static const JSC::Intrinsic s_transformStreamDefaultControllerEnqueueCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamDefaultControllerEnqueueCode = "(function (r){\"use strict\";if(!@isTransformStreamDefaultController(this))throw @makeThisTypeError(\"TransformStreamDefaultController\",\"enqueue\");@transformStreamDefaultControllerEnqueue(this,r)})\n";

// error
const JSC::ConstructAbility s_transformStreamDefaultControllerErrorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamDefaultControllerErrorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamDefaultControllerErrorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamDefaultControllerErrorCodeLength = 191;
static const JSC::Intrinsic s_transformStreamDefaultControllerErrorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamDefaultControllerErrorCode = "(function (e){\"use strict\";if(!@isTransformStreamDefaultController(this))throw @makeThisTypeError(\"TransformStreamDefaultController\",\"error\");@transformStreamDefaultControllerError(this,e)})\n";

// terminate
const JSC::ConstructAbility s_transformStreamDefaultControllerTerminateCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_transformStreamDefaultControllerTerminateCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_transformStreamDefaultControllerTerminateCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_transformStreamDefaultControllerTerminateCodeLength = 196;
static const JSC::Intrinsic s_transformStreamDefaultControllerTerminateCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_transformStreamDefaultControllerTerminateCode = "(function (){\"use strict\";if(!@isTransformStreamDefaultController(this))throw @makeThisTypeError(\"TransformStreamDefaultController\",\"terminate\");@transformStreamDefaultControllerTerminate(this)})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().transformStreamDefaultControllerBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().transformStreamDefaultControllerBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_TRANSFORMSTREAMDEFAULTCONTROLLER_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ReadableStreamBYOBReader.ts */
// initializeReadableStreamBYOBReader
const JSC::ConstructAbility s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCodeLength = 485;
static const JSC::Intrinsic s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCode = "(function (i){\"use strict\";if(!@isReadableStream(i))@throwTypeError(\"ReadableStreamBYOBReader needs a ReadableStream\");if(!@isReadableByteStreamController(@getByIdDirectPrivate(i,\"readableStreamController\")))@throwTypeError(\"ReadableStreamBYOBReader needs a ReadableByteStreamController\");if(@isReadableStreamLocked(i))@throwTypeError(\"ReadableStream is locked\");return @readableStreamReaderGenericInitialize(this,i),@putByIdDirectPrivate(this,\"readIntoRequests\",@createFIFO()),this})\n";

// cancel
const JSC::ConstructAbility s_readableStreamBYOBReaderCancelCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamBYOBReaderCancelCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamBYOBReaderCancelCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamBYOBReaderCancelCodeLength = 351;
static const JSC::Intrinsic s_readableStreamBYOBReaderCancelCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamBYOBReaderCancelCode = "(function (e){\"use strict\";if(!@isReadableStreamBYOBReader(this))return @Promise.@reject(@makeThisTypeError(\"ReadableStreamBYOBReader\",\"cancel\"));if(!@getByIdDirectPrivate(this,\"ownerReadableStream\"))return @Promise.@reject(@makeTypeError(\"cancel() called on a reader owned by no readable stream\"));return @readableStreamReaderGenericCancel(this,e)})\n";

// read
const JSC::ConstructAbility s_readableStreamBYOBReaderReadCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamBYOBReaderReadCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamBYOBReaderReadCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamBYOBReaderReadCodeLength = 647;
static const JSC::Intrinsic s_readableStreamBYOBReaderReadCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamBYOBReaderReadCode = "(function (r){\"use strict\";if(!@isReadableStreamBYOBReader(this))return @Promise.@reject(@makeThisTypeError(\"ReadableStreamBYOBReader\",\"read\"));if(!@getByIdDirectPrivate(this,\"ownerReadableStream\"))return @Promise.@reject(@makeTypeError(\"read() called on a reader owned by no readable stream\"));if(!@isObject(r))return @Promise.@reject(@makeTypeError(\"Provided view is not an object\"));if(!ArrayBuffer.@isView(r))return @Promise.@reject(@makeTypeError(\"Provided view is not an ArrayBufferView\"));if(r.byteLength===0)return @Promise.@reject(@makeTypeError(\"Provided view cannot have a 0 byteLength\"));return @readableStreamBYOBReaderRead(this,r)})\n";

// releaseLock
const JSC::ConstructAbility s_readableStreamBYOBReaderReleaseLockCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamBYOBReaderReleaseLockCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamBYOBReaderReleaseLockCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamBYOBReaderReleaseLockCodeLength = 382;
static const JSC::Intrinsic s_readableStreamBYOBReaderReleaseLockCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamBYOBReaderReleaseLockCode = "(function (){\"use strict\";if(!@isReadableStreamBYOBReader(this))throw @makeThisTypeError(\"ReadableStreamBYOBReader\",\"releaseLock\");if(!@getByIdDirectPrivate(this,\"ownerReadableStream\"))return;if(@getByIdDirectPrivate(this,\"readIntoRequests\")\?.isNotEmpty())@throwTypeError(\"There are still pending read requests, cannot release the lock\");@readableStreamReaderGenericRelease(this)})\n";

// closed
const JSC::ConstructAbility s_readableStreamBYOBReaderClosedCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamBYOBReaderClosedCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamBYOBReaderClosedCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamBYOBReaderClosedCodeLength = 219;
static const JSC::Intrinsic s_readableStreamBYOBReaderClosedCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamBYOBReaderClosedCode = "(function (){\"use strict\";if(!@isReadableStreamBYOBReader(this))return @Promise.@reject(@makeGetterTypeError(\"ReadableStreamBYOBReader\",\"closed\"));return @getByIdDirectPrivate(this,\"closedPromiseCapability\").@promise})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().readableStreamBYOBReaderBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().readableStreamBYOBReaderBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_READABLESTREAMBYOBREADER_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* JSBufferConstructor.ts */
// from
const JSC::ConstructAbility s_jsBufferConstructorFromCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_jsBufferConstructorFromCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_jsBufferConstructorFromCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_jsBufferConstructorFromCodeLength = 1106;
static const JSC::Intrinsic s_jsBufferConstructorFromCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_jsBufferConstructorFromCode = "(function (c){\"use strict\";if(@isUndefinedOrNull(c))@throwTypeError(\"The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object.\");if(typeof c===\"string\"||typeof c===\"object\"&&(@isTypedArrayView(c)||c instanceof ArrayBuffer||c instanceof SharedArrayBuffer||c instanceof String))switch(@argumentCount()){case 1:return new @Buffer(c);case 2:return new @Buffer(c,@argument(1));default:return new @Buffer(c,@argument(1),@argument(2))}var _=@toObject(c,\"The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object.\");if(!@isJSArray(_)){const d=@tryGetByIdWithWellKnownSymbol(c,\"toPrimitive\");if(d){const n=d.@call(c,\"string\");if(typeof n===\"string\")switch(@argumentCount()){case 1:return new @Buffer(n);case 2:return new @Buffer(n,@argument(1));default:return new @Buffer(n,@argument(1),@argument(2))}}if(!(\"length\"in _)||@isCallable(_))@throwTypeError(\"The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object.\")}return new @Buffer(@Uint8Array.from(_).buffer)})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().jsBufferConstructorBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().jsBufferConstructorBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_JSBUFFERCONSTRUCTOR_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ReadableStreamDefaultReader.ts */
// initializeReadableStreamDefaultReader
const JSC::ConstructAbility s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCodeLength = 314;
static const JSC::Intrinsic s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCode = "(function (i){\"use strict\";if(!@isReadableStream(i))@throwTypeError(\"ReadableStreamDefaultReader needs a ReadableStream\");if(@isReadableStreamLocked(i))@throwTypeError(\"ReadableStream is locked\");return @readableStreamReaderGenericInitialize(this,i),@putByIdDirectPrivate(this,\"readRequests\",@createFIFO()),this})\n";

// cancel
const JSC::ConstructAbility s_readableStreamDefaultReaderCancelCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamDefaultReaderCancelCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamDefaultReaderCancelCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultReaderCancelCodeLength = 357;
static const JSC::Intrinsic s_readableStreamDefaultReaderCancelCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamDefaultReaderCancelCode = "(function (e){\"use strict\";if(!@isReadableStreamDefaultReader(this))return @Promise.@reject(@makeThisTypeError(\"ReadableStreamDefaultReader\",\"cancel\"));if(!@getByIdDirectPrivate(this,\"ownerReadableStream\"))return @Promise.@reject(@makeTypeError(\"cancel() called on a reader owned by no readable stream\"));return @readableStreamReaderGenericCancel(this,e)})\n";

// readMany
const JSC::ConstructAbility s_readableStreamDefaultReaderReadManyCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamDefaultReaderReadManyCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamDefaultReaderReadManyCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultReaderReadManyCodeLength = 2598;
static const JSC::Intrinsic s_readableStreamDefaultReaderReadManyCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamDefaultReaderReadManyCode = "(function (){\"use strict\";if(!@isReadableStreamDefaultReader(this))@throwTypeError(\"ReadableStreamDefaultReader.readMany() should not be called directly\");const _=@getByIdDirectPrivate(this,\"ownerReadableStream\");if(!_)@throwTypeError(\"readMany() called on a reader owned by no readable stream\");const d=@getByIdDirectPrivate(_,\"state\");if(@putByIdDirectPrivate(_,\"disturbed\",!0),d===@streamClosed)return{value:[],size:0,done:!0};else if(d===@streamErrored)throw @getByIdDirectPrivate(_,\"storedError\");var B=@getByIdDirectPrivate(_,\"readableStreamController\"),C=@getByIdDirectPrivate(B,\"queue\");if(!C)return B.@pull(B).@then(function({done:F,value:G}){return F\?{done:!0,value:[],size:0}:{value:[G],size:1,done:!1}});const D=C.content;var S=C.size,j=D.toArray(!1),k=j.length;if(k>0){var w=@newArrayWithSize(k);if(@isReadableByteStreamController(B)){{const F=j[0];if(!(@ArrayBuffer.@isView(F)||F instanceof @ArrayBuffer))@putByValDirect(w,0,new @Uint8Array(F.buffer,F.byteOffset,F.byteLength));else @putByValDirect(w,0,F)}for(var x=1;x<k;x++){const F=j[x];if(!(@ArrayBuffer.@isView(F)||F instanceof @ArrayBuffer))@putByValDirect(w,x,new @Uint8Array(F.buffer,F.byteOffset,F.byteLength));else @putByValDirect(w,x,F)}}else{@putByValDirect(w,0,j[0].value);for(var x=1;x<k;x++)@putByValDirect(w,x,j[x].value)}if(@resetQueue(@getByIdDirectPrivate(B,\"queue\")),@getByIdDirectPrivate(B,\"closeRequested\"))@readableStreamClose(@getByIdDirectPrivate(B,\"controlledReadableStream\"));else if(@isReadableStreamDefaultController(B))@readableStreamDefaultControllerCallPullIfNeeded(B);else if(@isReadableByteStreamController(B))@readableByteStreamControllerCallPullIfNeeded(B);return{value:w,size:S,done:!1}}var A=(F)=>{if(F.done)return{value:[],size:0,done:!0};var G=@getByIdDirectPrivate(_,\"readableStreamController\"),H=@getByIdDirectPrivate(G,\"queue\"),I=[F.value].concat(H.content.toArray(!1)),J=I.length;if(@isReadableByteStreamController(G))for(var K=0;K<J;K++){const Q=I[K];if(!(@ArrayBuffer.@isView(Q)||Q instanceof @ArrayBuffer)){const{buffer:T,byteOffset:U,byteLength:W}=Q;@putByValDirect(I,K,new @Uint8Array(T,U,W))}}else for(var K=1;K<J;K++)@putByValDirect(I,K,I[K].value);var N=H.size;if(@resetQueue(H),@getByIdDirectPrivate(G,\"closeRequested\"))@readableStreamClose(@getByIdDirectPrivate(G,\"controlledReadableStream\"));else if(@isReadableStreamDefaultController(G))@readableStreamDefaultControllerCallPullIfNeeded(G);else if(@isReadableByteStreamController(G))@readableByteStreamControllerCallPullIfNeeded(G);return{value:I,size:N,done:!1}},E=B.@pull(B);if(E&&@isPromise(E))return E.@then(A);return A(E)})\n";

// read
const JSC::ConstructAbility s_readableStreamDefaultReaderReadCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamDefaultReaderReadCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamDefaultReaderReadCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultReaderReadCodeLength = 348;
static const JSC::Intrinsic s_readableStreamDefaultReaderReadCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamDefaultReaderReadCode = "(function (){\"use strict\";if(!@isReadableStreamDefaultReader(this))return @Promise.@reject(@makeThisTypeError(\"ReadableStreamDefaultReader\",\"read\"));if(!@getByIdDirectPrivate(this,\"ownerReadableStream\"))return @Promise.@reject(@makeTypeError(\"read() called on a reader owned by no readable stream\"));return @readableStreamDefaultReaderRead(this)})\n";

// releaseLock
const JSC::ConstructAbility s_readableStreamDefaultReaderReleaseLockCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamDefaultReaderReleaseLockCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamDefaultReaderReleaseLockCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultReaderReleaseLockCodeLength = 384;
static const JSC::Intrinsic s_readableStreamDefaultReaderReleaseLockCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamDefaultReaderReleaseLockCode = "(function (){\"use strict\";if(!@isReadableStreamDefaultReader(this))throw @makeThisTypeError(\"ReadableStreamDefaultReader\",\"releaseLock\");if(!@getByIdDirectPrivate(this,\"ownerReadableStream\"))return;if(@getByIdDirectPrivate(this,\"readRequests\")\?.isNotEmpty())@throwTypeError(\"There are still pending read requests, cannot release the lock\");@readableStreamReaderGenericRelease(this)})\n";

// closed
const JSC::ConstructAbility s_readableStreamDefaultReaderClosedCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamDefaultReaderClosedCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamDefaultReaderClosedCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultReaderClosedCodeLength = 225;
static const JSC::Intrinsic s_readableStreamDefaultReaderClosedCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamDefaultReaderClosedCode = "(function (){\"use strict\";if(!@isReadableStreamDefaultReader(this))return @Promise.@reject(@makeGetterTypeError(\"ReadableStreamDefaultReader\",\"closed\"));return @getByIdDirectPrivate(this,\"closedPromiseCapability\").@promise})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().readableStreamDefaultReaderBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().readableStreamDefaultReaderBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_READABLESTREAMDEFAULTREADER_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* StreamInternals.ts */
// markPromiseAsHandled
const JSC::ConstructAbility s_streamInternalsMarkPromiseAsHandledCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsMarkPromiseAsHandledCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsMarkPromiseAsHandledCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsMarkPromiseAsHandledCodeLength = 169;
static const JSC::Intrinsic s_streamInternalsMarkPromiseAsHandledCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsMarkPromiseAsHandledCode = "(function (c){\"use strict\";@assert(@isPromise(c)),@putPromiseInternalField(c,@promiseFieldFlags,@getPromiseInternalField(c,@promiseFieldFlags)|@promiseFlagsIsHandled)})\n";

// shieldingPromiseResolve
const JSC::ConstructAbility s_streamInternalsShieldingPromiseResolveCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsShieldingPromiseResolveCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsShieldingPromiseResolveCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsShieldingPromiseResolveCodeLength = 124;
static const JSC::Intrinsic s_streamInternalsShieldingPromiseResolveCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsShieldingPromiseResolveCode = "(function (_){\"use strict\";const a=@Promise.@resolve(_);if(a.@then===@undefined)a.@then=@Promise.prototype.@then;return a})\n";

// promiseInvokeOrNoopMethodNoCatch
const JSC::ConstructAbility s_streamInternalsPromiseInvokeOrNoopMethodNoCatchCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsPromiseInvokeOrNoopMethodNoCatchCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsPromiseInvokeOrNoopMethodNoCatchCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsPromiseInvokeOrNoopMethodNoCatchCodeLength = 125;
static const JSC::Intrinsic s_streamInternalsPromiseInvokeOrNoopMethodNoCatchCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsPromiseInvokeOrNoopMethodNoCatchCode = "(function (r,i,n){\"use strict\";if(i===@undefined)return @Promise.@resolve();return @shieldingPromiseResolve(i.@apply(r,n))})\n";

// promiseInvokeOrNoopNoCatch
const JSC::ConstructAbility s_streamInternalsPromiseInvokeOrNoopNoCatchCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsPromiseInvokeOrNoopNoCatchCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsPromiseInvokeOrNoopNoCatchCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsPromiseInvokeOrNoopNoCatchCodeLength = 84;
static const JSC::Intrinsic s_streamInternalsPromiseInvokeOrNoopNoCatchCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsPromiseInvokeOrNoopNoCatchCode = "(function (r,d,n){\"use strict\";return @promiseInvokeOrNoopMethodNoCatch(r,r[d],n)})\n";

// promiseInvokeOrNoopMethod
const JSC::ConstructAbility s_streamInternalsPromiseInvokeOrNoopMethodCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsPromiseInvokeOrNoopMethodCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsPromiseInvokeOrNoopMethodCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsPromiseInvokeOrNoopMethodCodeLength = 122;
static const JSC::Intrinsic s_streamInternalsPromiseInvokeOrNoopMethodCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsPromiseInvokeOrNoopMethodCode = "(function (r,_,n){\"use strict\";try{return @promiseInvokeOrNoopMethodNoCatch(r,_,n)}catch(p){return @Promise.@reject(p)}})\n";

// promiseInvokeOrNoop
const JSC::ConstructAbility s_streamInternalsPromiseInvokeOrNoopCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsPromiseInvokeOrNoopCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsPromiseInvokeOrNoopCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsPromiseInvokeOrNoopCodeLength = 116;
static const JSC::Intrinsic s_streamInternalsPromiseInvokeOrNoopCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsPromiseInvokeOrNoopCode = "(function (t,_,d){\"use strict\";try{return @promiseInvokeOrNoopNoCatch(t,_,d)}catch(h){return @Promise.@reject(h)}})\n";

// promiseInvokeOrFallbackOrNoop
const JSC::ConstructAbility s_streamInternalsPromiseInvokeOrFallbackOrNoopCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsPromiseInvokeOrFallbackOrNoopCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsPromiseInvokeOrFallbackOrNoopCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsPromiseInvokeOrFallbackOrNoopCodeLength = 198;
static const JSC::Intrinsic s_streamInternalsPromiseInvokeOrFallbackOrNoopCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsPromiseInvokeOrFallbackOrNoopCode = "(function (i,n,u,p,N){\"use strict\";try{const _=i[n];if(_===@undefined)return @promiseInvokeOrNoopNoCatch(i,p,N);return @shieldingPromiseResolve(_.@apply(i,u))}catch(_){return @Promise.@reject(_)}})\n";

// validateAndNormalizeQueuingStrategy
const JSC::ConstructAbility s_streamInternalsValidateAndNormalizeQueuingStrategyCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsValidateAndNormalizeQueuingStrategyCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsValidateAndNormalizeQueuingStrategyCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsValidateAndNormalizeQueuingStrategyCodeLength = 263;
static const JSC::Intrinsic s_streamInternalsValidateAndNormalizeQueuingStrategyCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsValidateAndNormalizeQueuingStrategyCode = "(function (o,b){\"use strict\";if(o!==@undefined&&typeof o!==\"function\")@throwTypeError(\"size parameter must be a function\");const c=@toNumber(b);if(@isNaN(c)||c<0)@throwRangeError(\"highWaterMark value is negative or not a number\");return{size:o,highWaterMark:c}})\n";

// createFIFO
const JSC::ConstructAbility s_streamInternalsCreateFIFOCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsCreateFIFOCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsCreateFIFOCodeImplementationVisibility = JSC::ImplementationVisibility::Private;
const int s_streamInternalsCreateFIFOCodeLength = 1472;
static const JSC::Intrinsic s_streamInternalsCreateFIFOCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsCreateFIFOCode = "(function (){\"use strict\";var c=@Array.prototype.slice;class g{constructor(){this._head=0,this._tail=0,this._capacityMask=3,this._list=@newArrayWithSize(4)}_head;_tail;_capacityMask;_list;size(){if(this._head===this._tail)return 0;if(this._head<this._tail)return this._tail-this._head;else return this._capacityMask+1-(this._head-this._tail)}isEmpty(){return this.size()==0}isNotEmpty(){return this.size()>0}shift(){var{_head:k,_tail:v,_list:b,_capacityMask:w}=this;if(k===v)return @undefined;var x=b[k];if(@putByValDirect(b,k,@undefined),k=this._head=k+1&w,k<2&&v>1e4&&v<=b.length>>>2)this._shrinkArray();return x}peek(){if(this._head===this._tail)return @undefined;return this._list[this._head]}push(k){var v=this._tail;if(@putByValDirect(this._list,v,k),this._tail=v+1&this._capacityMask,this._tail===this._head)this._growArray()}toArray(k){var v=this._list,b=@toLength(v.length);if(k||this._head>this._tail){var w=@toLength(this._head),x=@toLength(this._tail),z=@toLength(b-w+x),A=@newArrayWithSize(z),B=0;for(var E=w;E<b;E++)@putByValDirect(A,B++,v[E]);for(var E=0;E<x;E++)@putByValDirect(A,B++,v[E]);return A}else return c.@call(v,this._head,this._tail)}clear(){this._head=0,this._tail=0,this._list.fill(@undefined)}_growArray(){if(this._head)this._list=this.toArray(!0),this._head=0;this._tail=@toLength(this._list.length),this._list.length<<=1,this._capacityMask=this._capacityMask<<1|1}shrinkArray(){this._list.length>>>=1,this._capacityMask>>>=1}}return new g})\n";

// newQueue
const JSC::ConstructAbility s_streamInternalsNewQueueCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsNewQueueCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsNewQueueCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsNewQueueCodeLength = 65;
static const JSC::Intrinsic s_streamInternalsNewQueueCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsNewQueueCode = "(function (){\"use strict\";return{content:@createFIFO(),size:0}})\n";

// dequeueValue
const JSC::ConstructAbility s_streamInternalsDequeueValueCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsDequeueValueCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsDequeueValueCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsDequeueValueCodeLength = 106;
static const JSC::Intrinsic s_streamInternalsDequeueValueCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsDequeueValueCode = "(function (a){\"use strict\";const i=a.content.shift();if(a.size-=i.size,a.size<0)a.size=0;return i.value})\n";

// enqueueValueWithSize
const JSC::ConstructAbility s_streamInternalsEnqueueValueWithSizeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsEnqueueValueWithSizeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsEnqueueValueWithSizeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsEnqueueValueWithSizeCodeLength = 161;
static const JSC::Intrinsic s_streamInternalsEnqueueValueWithSizeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsEnqueueValueWithSizeCode = "(function (t,r,o){\"use strict\";if(o=@toNumber(o),!@isFinite(o)||o<0)@throwRangeError(\"size has an incorrect value\");t.content.push({value:r,size:o}),t.size+=o})\n";

// peekQueueValue
const JSC::ConstructAbility s_streamInternalsPeekQueueValueCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsPeekQueueValueCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsPeekQueueValueCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsPeekQueueValueCodeLength = 60;
static const JSC::Intrinsic s_streamInternalsPeekQueueValueCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsPeekQueueValueCode = "(function (r){\"use strict\";return r.content.peek()\?.value})\n";

// resetQueue
const JSC::ConstructAbility s_streamInternalsResetQueueCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsResetQueueCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsResetQueueCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsResetQueueCodeLength = 99;
static const JSC::Intrinsic s_streamInternalsResetQueueCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsResetQueueCode = "(function (r){\"use strict\";@assert(\"content\"in r),@assert(\"size\"in r),r.content.clear(),r.size=0})\n";

// extractSizeAlgorithm
const JSC::ConstructAbility s_streamInternalsExtractSizeAlgorithmCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsExtractSizeAlgorithmCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsExtractSizeAlgorithmCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsExtractSizeAlgorithmCodeLength = 176;
static const JSC::Intrinsic s_streamInternalsExtractSizeAlgorithmCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsExtractSizeAlgorithmCode = "(function (d){\"use strict\";const n=d.size;if(n===@undefined)return()=>1;if(typeof n!==\"function\")@throwTypeError(\"strategy.size must be a function\");return(p)=>{return n(p)}})\n";

// extractHighWaterMark
const JSC::ConstructAbility s_streamInternalsExtractHighWaterMarkCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsExtractHighWaterMarkCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsExtractHighWaterMarkCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsExtractHighWaterMarkCodeLength = 188;
static const JSC::Intrinsic s_streamInternalsExtractHighWaterMarkCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsExtractHighWaterMarkCode = "(function (c,n){\"use strict\";const p=c.highWaterMark;if(p===@undefined)return n;if(@isNaN(p)||p<0)@throwRangeError(\"highWaterMark value is negative or not a number\");return @toNumber(p)})\n";

// extractHighWaterMarkFromQueuingStrategyInit
const JSC::ConstructAbility s_streamInternalsExtractHighWaterMarkFromQueuingStrategyInitCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsExtractHighWaterMarkFromQueuingStrategyInitCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsExtractHighWaterMarkFromQueuingStrategyInitCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsExtractHighWaterMarkFromQueuingStrategyInitCodeLength = 249;
static const JSC::Intrinsic s_streamInternalsExtractHighWaterMarkFromQueuingStrategyInitCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsExtractHighWaterMarkFromQueuingStrategyInitCode = "(function (u){\"use strict\";if(!@isObject(u))@throwTypeError(\"QueuingStrategyInit argument must be an object.\");const{highWaterMark:c}=u;if(c===@undefined)@throwTypeError(\"QueuingStrategyInit.highWaterMark member is required.\");return @toNumber(c)})\n";

// createFulfilledPromise
const JSC::ConstructAbility s_streamInternalsCreateFulfilledPromiseCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsCreateFulfilledPromiseCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsCreateFulfilledPromiseCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsCreateFulfilledPromiseCodeLength = 81;
static const JSC::Intrinsic s_streamInternalsCreateFulfilledPromiseCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsCreateFulfilledPromiseCode = "(function (t){\"use strict\";const w=@newPromise();return @fulfillPromise(w,t),w})\n";

// toDictionary
const JSC::ConstructAbility s_streamInternalsToDictionaryCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_streamInternalsToDictionaryCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_streamInternalsToDictionaryCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_streamInternalsToDictionaryCodeLength = 115;
static const JSC::Intrinsic s_streamInternalsToDictionaryCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_streamInternalsToDictionaryCode = "(function (n,_,c){\"use strict\";if(n===@undefined||n===null)return _;if(!@isObject(n))@throwTypeError(c);return n})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().streamInternalsBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().streamInternalsBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_STREAMINTERNALS_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ImportMetaObject.ts */
// loadCJS2ESM
const JSC::ConstructAbility s_importMetaObjectLoadCJS2ESMCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_importMetaObjectLoadCJS2ESMCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_importMetaObjectLoadCJS2ESMCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_importMetaObjectLoadCJS2ESMCodeLength = 1309;
static const JSC::Intrinsic s_importMetaObjectLoadCJS2ESMCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_importMetaObjectLoadCJS2ESMCode = "(function (T){\"use strict\";var L=@Loader,w=@createFIFO(),x=T;while(x){var z=L.registry.@get(x);if(!z||!z.state||z.state<=@ModuleFetch)@fulfillModuleSync(x),z=L.registry.@get(x);var B=@getPromiseInternalField(z.fetch,@promiseFieldReactionsOrResult),D=L.parseModule(x,B),F=z.module;if(!F&&D&&@isPromise(D)){var G=@getPromiseInternalField(D,@promiseFieldReactionsOrResult),H=@getPromiseInternalField(D,@promiseFieldFlags),I=H&@promiseStateMask;if(I===@promiseStatePending||G&&@isPromise(G))@throwTypeError(`require() async module \"${x}\" is unsupported`);else if(I===@promiseStateRejected)@throwTypeError(`${G\?.message\?\?\"An error occurred\"} while parsing module \\\"${x}\\\"`);z.module=F=G}else if(D&&!F)z.module=F=D;@setStateToMax(z,@ModuleLink);var J=F.dependenciesMap,Q=L.requestedModules(F),U=@newArrayWithSize(Q.length);for(var V=0,W=Q.length;V<W;++V){var X=Q[V],Y=X[0]===\"/\"\?X:L.resolve(X,x),Z=L.ensureRegistered(Y);if(Z.state<@ModuleLink)w.push(Y);@putByValDirect(U,V,Z),J.@set(X,Z)}z.dependencies=U,z.instantiate=@Promise.resolve(z),z.satisfy=@Promise.resolve(z),x=w.shift();while(x&&(L.registry.@get(x)\?.state\?\?@ModuleFetch)>=@ModuleLink)x=w.shift()}var _=L.linkAndEvaluateModule(T,@undefined);if(_&&@isPromise(_))@throwTypeError(`require() async module \\\"${T}\\\" is unsupported`);return L.registry.@get(T)})\n";

// requireESM
const JSC::ConstructAbility s_importMetaObjectRequireESMCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_importMetaObjectRequireESMCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_importMetaObjectRequireESMCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_importMetaObjectRequireESMCodeLength = 382;
static const JSC::Intrinsic s_importMetaObjectRequireESMCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_importMetaObjectRequireESMCode = "(function (i){\"use strict\";var T=@Loader.registry.@get(i);if(!T||!T.evaluated)T=@loadCJS2ESM(i);if(!T||!T.evaluated||!T.module)@throwTypeError(`require() failed to evaluate module \"${i}\". This is an internal consistentency error.`);var _=@Loader.getModuleNamespaceObject(T.module),a=_.default,b=a\?.[@commonJSSymbol];if(b===0)return a;else if(b&&@isCallable(a))return a();return _})\n";

// internalRequire
const JSC::ConstructAbility s_importMetaObjectInternalRequireCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_importMetaObjectInternalRequireCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_importMetaObjectInternalRequireCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_importMetaObjectInternalRequireCodeLength = 569;
static const JSC::Intrinsic s_importMetaObjectInternalRequireCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_importMetaObjectInternalRequireCode = "(function (_){\"use strict\";var b=@requireMap.@get(_);const i=_.substring(_.length-5);if(b){if(i===\".node\")return b.exports;return b}if(i===\".json\"){var n=globalThis[Symbol.for(\"_fs\")]||=@Bun.fs(),g=JSON.parse(n.readFileSync(_,\"utf8\"));return @requireMap.@set(_,g),g}else if(i===\".node\"){var j={exports:{}};return process.dlopen(j,_),@requireMap.@set(_,j),j.exports}else if(i===\".toml\"){var n=globalThis[Symbol.for(\"_fs\")]||=@Bun.fs(),g=@Bun.TOML.parse(n.readFileSync(_,\"utf8\"));return @requireMap.@set(_,g),g}else{var g=@requireESM(_);return @requireMap.@set(_,g),g}})\n";

// require
const JSC::ConstructAbility s_importMetaObjectRequireCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_importMetaObjectRequireCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_importMetaObjectRequireCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_importMetaObjectRequireCodeLength = 187;
static const JSC::Intrinsic s_importMetaObjectRequireCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_importMetaObjectRequireCode = "(function (r){\"use strict\";const i=this\?.path\?\?arguments.callee.path;if(typeof r!==\"string\")@throwTypeError(\"require(name) must be a string\");return @internalRequire(@resolveSync(r,i))})\n";

// main
const JSC::ConstructAbility s_importMetaObjectMainCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_importMetaObjectMainCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_importMetaObjectMainCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_importMetaObjectMainCodeLength = 57;
static const JSC::Intrinsic s_importMetaObjectMainCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_importMetaObjectMainCode = "(function (){\"use strict\";return this.path===@Bun.main})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().importMetaObjectBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().importMetaObjectBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_IMPORTMETAOBJECT_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* CountQueuingStrategy.ts */
// highWaterMark
const JSC::ConstructAbility s_countQueuingStrategyHighWaterMarkCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_countQueuingStrategyHighWaterMarkCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_countQueuingStrategyHighWaterMarkCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_countQueuingStrategyHighWaterMarkCodeLength = 205;
static const JSC::Intrinsic s_countQueuingStrategyHighWaterMarkCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_countQueuingStrategyHighWaterMarkCode = "(function (){\"use strict\";const n=@getByIdDirectPrivate(this,\"highWaterMark\");if(n===@undefined)@throwTypeError(\"CountQueuingStrategy.highWaterMark getter called on incompatible |this| value.\");return n})\n";

// size
const JSC::ConstructAbility s_countQueuingStrategySizeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_countQueuingStrategySizeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_countQueuingStrategySizeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_countQueuingStrategySizeCodeLength = 37;
static const JSC::Intrinsic s_countQueuingStrategySizeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_countQueuingStrategySizeCode = "(function (){\"use strict\";return 1})\n";

// initializeCountQueuingStrategy
const JSC::ConstructAbility s_countQueuingStrategyInitializeCountQueuingStrategyCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_countQueuingStrategyInitializeCountQueuingStrategyCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_countQueuingStrategyInitializeCountQueuingStrategyCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_countQueuingStrategyInitializeCountQueuingStrategyCodeLength = 121;
static const JSC::Intrinsic s_countQueuingStrategyInitializeCountQueuingStrategyCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_countQueuingStrategyInitializeCountQueuingStrategyCode = "(function (c){\"use strict\";@putByIdDirectPrivate(this,\"highWaterMark\",@extractHighWaterMarkFromQueuingStrategyInit(c))})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().countQueuingStrategyBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().countQueuingStrategyBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ReadableStreamBYOBRequest.ts */
// initializeReadableStreamBYOBRequest
const JSC::ConstructAbility s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCodeLength = 243;
static const JSC::Intrinsic s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCode = "(function (m,u){\"use strict\";if(arguments.length!==3&&arguments[2]!==@isReadableStream)@throwTypeError(\"ReadableStreamBYOBRequest constructor should not be called directly\");return @privateInitializeReadableStreamBYOBRequest.@call(this,m,u)})\n";

// respond
const JSC::ConstructAbility s_readableStreamBYOBRequestRespondCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamBYOBRequestRespondCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamBYOBRequestRespondCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamBYOBRequestRespondCodeLength = 430;
static const JSC::Intrinsic s_readableStreamBYOBRequestRespondCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamBYOBRequestRespondCode = "(function (e){\"use strict\";if(!@isReadableStreamBYOBRequest(this))throw @makeThisTypeError(\"ReadableStreamBYOBRequest\",\"respond\");if(@getByIdDirectPrivate(this,\"associatedReadableByteStreamController\")===@undefined)@throwTypeError(\"ReadableStreamBYOBRequest.associatedReadableByteStreamController is undefined\");return @readableByteStreamControllerRespond(@getByIdDirectPrivate(this,\"associatedReadableByteStreamController\"),e)})\n";

// respondWithNewView
const JSC::ConstructAbility s_readableStreamBYOBRequestRespondWithNewViewCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamBYOBRequestRespondWithNewViewCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamBYOBRequestRespondWithNewViewCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamBYOBRequestRespondWithNewViewCodeLength = 594;
static const JSC::Intrinsic s_readableStreamBYOBRequestRespondWithNewViewCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamBYOBRequestRespondWithNewViewCode = "(function (r){\"use strict\";if(!@isReadableStreamBYOBRequest(this))throw @makeThisTypeError(\"ReadableStreamBYOBRequest\",\"respond\");if(@getByIdDirectPrivate(this,\"associatedReadableByteStreamController\")===@undefined)@throwTypeError(\"ReadableStreamBYOBRequest.associatedReadableByteStreamController is undefined\");if(!@isObject(r))@throwTypeError(\"Provided view is not an object\");if(!ArrayBuffer.@isView(r))@throwTypeError(\"Provided view is not an ArrayBufferView\");return @readableByteStreamControllerRespondWithNewView(@getByIdDirectPrivate(this,\"associatedReadableByteStreamController\"),r)})\n";

// view
const JSC::ConstructAbility s_readableStreamBYOBRequestViewCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamBYOBRequestViewCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamBYOBRequestViewCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamBYOBRequestViewCodeLength = 172;
static const JSC::Intrinsic s_readableStreamBYOBRequestViewCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamBYOBRequestViewCode = "(function (){\"use strict\";if(!@isReadableStreamBYOBRequest(this))throw @makeGetterTypeError(\"ReadableStreamBYOBRequest\",\"view\");return @getByIdDirectPrivate(this,\"view\")})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().readableStreamBYOBRequestBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().readableStreamBYOBRequestBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_READABLESTREAMBYOBREQUEST_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* WritableStreamDefaultWriter.ts */
// initializeWritableStreamDefaultWriter
const JSC::ConstructAbility s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCodeLength = 237;
static const JSC::Intrinsic s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCode = "(function (c){\"use strict\";const _=@getInternalWritableStream(c);if(_)c=_;if(!@isWritableStream(c))@throwTypeError(\"WritableStreamDefaultWriter constructor takes a WritableStream\");return @setUpWritableStreamDefaultWriter(this,c),this})\n";

// closed
const JSC::ConstructAbility s_writableStreamDefaultWriterClosedCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamDefaultWriterClosedCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamDefaultWriterClosedCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultWriterClosedCodeLength = 215;
static const JSC::Intrinsic s_writableStreamDefaultWriterClosedCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamDefaultWriterClosedCode = "(function (){\"use strict\";if(!@isWritableStreamDefaultWriter(this))return @Promise.@reject(@makeGetterTypeError(\"WritableStreamDefaultWriter\",\"closed\"));return @getByIdDirectPrivate(this,\"closedPromise\").@promise})\n";

// desiredSize
const JSC::ConstructAbility s_writableStreamDefaultWriterDesiredSizeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamDefaultWriterDesiredSizeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamDefaultWriterDesiredSizeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultWriterDesiredSizeCodeLength = 309;
static const JSC::Intrinsic s_writableStreamDefaultWriterDesiredSizeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamDefaultWriterDesiredSizeCode = "(function (){\"use strict\";if(!@isWritableStreamDefaultWriter(this))throw @makeThisTypeError(\"WritableStreamDefaultWriter\",\"desiredSize\");if(@getByIdDirectPrivate(this,\"stream\")===@undefined)@throwTypeError(\"WritableStreamDefaultWriter has no stream\");return @writableStreamDefaultWriterGetDesiredSize(this)})\n";

// ready
const JSC::ConstructAbility s_writableStreamDefaultWriterReadyCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamDefaultWriterReadyCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamDefaultWriterReadyCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultWriterReadyCodeLength = 211;
static const JSC::Intrinsic s_writableStreamDefaultWriterReadyCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamDefaultWriterReadyCode = "(function (){\"use strict\";if(!@isWritableStreamDefaultWriter(this))return @Promise.@reject(@makeThisTypeError(\"WritableStreamDefaultWriter\",\"ready\"));return @getByIdDirectPrivate(this,\"readyPromise\").@promise})\n";

// abort
const JSC::ConstructAbility s_writableStreamDefaultWriterAbortCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamDefaultWriterAbortCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamDefaultWriterAbortCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultWriterAbortCodeLength = 340;
static const JSC::Intrinsic s_writableStreamDefaultWriterAbortCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamDefaultWriterAbortCode = "(function (e){\"use strict\";if(!@isWritableStreamDefaultWriter(this))return @Promise.@reject(@makeThisTypeError(\"WritableStreamDefaultWriter\",\"abort\"));if(@getByIdDirectPrivate(this,\"stream\")===@undefined)return @Promise.@reject(@makeTypeError(\"WritableStreamDefaultWriter has no stream\"));return @writableStreamDefaultWriterAbort(this,e)})\n";

// close
const JSC::ConstructAbility s_writableStreamDefaultWriterCloseCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamDefaultWriterCloseCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamDefaultWriterCloseCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultWriterCloseCodeLength = 477;
static const JSC::Intrinsic s_writableStreamDefaultWriterCloseCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamDefaultWriterCloseCode = "(function (){\"use strict\";if(!@isWritableStreamDefaultWriter(this))return @Promise.@reject(@makeThisTypeError(\"WritableStreamDefaultWriter\",\"close\"));const n=@getByIdDirectPrivate(this,\"stream\");if(n===@undefined)return @Promise.@reject(@makeTypeError(\"WritableStreamDefaultWriter has no stream\"));if(@writableStreamCloseQueuedOrInFlight(n))return @Promise.@reject(@makeTypeError(\"WritableStreamDefaultWriter is being closed\"));return @writableStreamDefaultWriterClose(this)})\n";

// releaseLock
const JSC::ConstructAbility s_writableStreamDefaultWriterReleaseLockCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamDefaultWriterReleaseLockCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamDefaultWriterReleaseLockCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultWriterReleaseLockCodeLength = 307;
static const JSC::Intrinsic s_writableStreamDefaultWriterReleaseLockCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamDefaultWriterReleaseLockCode = "(function (){\"use strict\";if(!@isWritableStreamDefaultWriter(this))throw @makeThisTypeError(\"WritableStreamDefaultWriter\",\"releaseLock\");const r=@getByIdDirectPrivate(this,\"stream\");if(r===@undefined)return;@assert(@getByIdDirectPrivate(r,\"writer\")!==@undefined),@writableStreamDefaultWriterRelease(this)})\n";

// write
const JSC::ConstructAbility s_writableStreamDefaultWriterWriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamDefaultWriterWriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamDefaultWriterWriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultWriterWriteCodeLength = 340;
static const JSC::Intrinsic s_writableStreamDefaultWriterWriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamDefaultWriterWriteCode = "(function (r){\"use strict\";if(!@isWritableStreamDefaultWriter(this))return @Promise.@reject(@makeThisTypeError(\"WritableStreamDefaultWriter\",\"write\"));if(@getByIdDirectPrivate(this,\"stream\")===@undefined)return @Promise.@reject(@makeTypeError(\"WritableStreamDefaultWriter has no stream\"));return @writableStreamDefaultWriterWrite(this,r)})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().writableStreamDefaultWriterBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().writableStreamDefaultWriterBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_WRITABLESTREAMDEFAULTWRITER_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ReadableStream.ts */
// initializeReadableStream
const JSC::ConstructAbility s_readableStreamInitializeReadableStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamInitializeReadableStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamInitializeReadableStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamInitializeReadableStreamCodeLength = 2065;
static const JSC::Intrinsic s_readableStreamInitializeReadableStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamInitializeReadableStreamCode = "(function (_,f){\"use strict\";if(_===@undefined)_={@bunNativeType:0,@bunNativePtr:0,@lazy:!1};if(f===@undefined)f={};if(!@isObject(_))@throwTypeError(\"ReadableStream constructor takes an object as first argument\");if(f!==@undefined&&!@isObject(f))@throwTypeError(\"ReadableStream constructor takes an object as second argument, if any\");@putByIdDirectPrivate(this,\"state\",@streamReadable),@putByIdDirectPrivate(this,\"reader\",@undefined),@putByIdDirectPrivate(this,\"storedError\",@undefined),@putByIdDirectPrivate(this,\"disturbed\",!1),@putByIdDirectPrivate(this,\"readableStreamController\",null),@putByIdDirectPrivate(this,\"bunNativeType\",@getByIdDirectPrivate(_,\"bunNativeType\")\?\?0),@putByIdDirectPrivate(this,\"bunNativePtr\",@getByIdDirectPrivate(_,\"bunNativePtr\")\?\?0);const v=_.type===\"direct\",I=!!_.@lazy,N=v||I;if(@getByIdDirectPrivate(_,\"pull\")!==@undefined&&!N){const P=@getByIdDirectPrivate(f,\"size\"),b=@getByIdDirectPrivate(f,\"highWaterMark\");return @putByIdDirectPrivate(this,\"highWaterMark\",b),@putByIdDirectPrivate(this,\"underlyingSource\",@undefined),@setupReadableStreamDefaultController(this,_,P,b!==@undefined\?b:1,@getByIdDirectPrivate(_,\"start\"),@getByIdDirectPrivate(_,\"pull\"),@getByIdDirectPrivate(_,\"cancel\")),this}if(v)@putByIdDirectPrivate(this,\"underlyingSource\",_),@putByIdDirectPrivate(this,\"highWaterMark\",@getByIdDirectPrivate(f,\"highWaterMark\")),@putByIdDirectPrivate(this,\"start\",()=>@createReadableStreamController(this,_,f));else if(N){const P=_.autoAllocateChunkSize;@putByIdDirectPrivate(this,\"highWaterMark\",@undefined),@putByIdDirectPrivate(this,\"underlyingSource\",@undefined),@putByIdDirectPrivate(this,\"highWaterMark\",P||@getByIdDirectPrivate(f,\"highWaterMark\")),@putByIdDirectPrivate(this,\"start\",()=>{const b=@lazyLoadStream(this,P);if(b)@createReadableStreamController(this,b,f)})}else @putByIdDirectPrivate(this,\"underlyingSource\",@undefined),@putByIdDirectPrivate(this,\"highWaterMark\",@getByIdDirectPrivate(f,\"highWaterMark\")),@putByIdDirectPrivate(this,\"start\",@undefined),@createReadableStreamController(this,_,f);return this})\n";

// readableStreamToArray
const JSC::ConstructAbility s_readableStreamReadableStreamToArrayCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamReadableStreamToArrayCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamReadableStreamToArrayCodeImplementationVisibility = JSC::ImplementationVisibility::Private;
const int s_readableStreamReadableStreamToArrayCodeLength = 173;
static const JSC::Intrinsic s_readableStreamReadableStreamToArrayCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamReadableStreamToArrayCode = "(function (_){\"use strict\";var p=@getByIdDirectPrivate(_,\"underlyingSource\");if(p!==@undefined)return @readableStreamToArrayDirect(_,p);return @readableStreamIntoArray(_)})\n";

// readableStreamToText
const JSC::ConstructAbility s_readableStreamReadableStreamToTextCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamReadableStreamToTextCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamReadableStreamToTextCodeImplementationVisibility = JSC::ImplementationVisibility::Private;
const int s_readableStreamReadableStreamToTextCodeLength = 171;
static const JSC::Intrinsic s_readableStreamReadableStreamToTextCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamReadableStreamToTextCode = "(function (_){\"use strict\";var p=@getByIdDirectPrivate(_,\"underlyingSource\");if(p!==@undefined)return @readableStreamToTextDirect(_,p);return @readableStreamIntoText(_)})\n";

// readableStreamToArrayBuffer
const JSC::ConstructAbility s_readableStreamReadableStreamToArrayBufferCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamReadableStreamToArrayBufferCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamReadableStreamToArrayBufferCodeImplementationVisibility = JSC::ImplementationVisibility::Private;
const int s_readableStreamReadableStreamToArrayBufferCodeLength = 212;
static const JSC::Intrinsic s_readableStreamReadableStreamToArrayBufferCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamReadableStreamToArrayBufferCode = "(function (_){\"use strict\";var p=@getByIdDirectPrivate(_,\"underlyingSource\");if(p!==@undefined)return @readableStreamToArrayBufferDirect(_,p);return @Bun.readableStreamToArray(_).@then(@Bun.concatArrayBuffers)})\n";

// readableStreamToJSON
const JSC::ConstructAbility s_readableStreamReadableStreamToJSONCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamReadableStreamToJSONCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamReadableStreamToJSONCodeImplementationVisibility = JSC::ImplementationVisibility::Private;
const int s_readableStreamReadableStreamToJSONCodeLength = 94;
static const JSC::Intrinsic s_readableStreamReadableStreamToJSONCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamReadableStreamToJSONCode = "(function (d){\"use strict\";return @Bun.readableStreamToText(d).@then(globalThis.JSON.parse)})\n";

// readableStreamToBlob
const JSC::ConstructAbility s_readableStreamReadableStreamToBlobCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamReadableStreamToBlobCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamReadableStreamToBlobCodeImplementationVisibility = JSC::ImplementationVisibility::Private;
const int s_readableStreamReadableStreamToBlobCodeLength = 108;
static const JSC::Intrinsic s_readableStreamReadableStreamToBlobCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamReadableStreamToBlobCode = "(function (u){\"use strict\";return @Promise.resolve(@Bun.readableStreamToArray(u)).@then((c)=>new Blob(c))})\n";

// consumeReadableStream
const JSC::ConstructAbility s_readableStreamConsumeReadableStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamConsumeReadableStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamConsumeReadableStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Private;
const int s_readableStreamConsumeReadableStreamCodeLength = 1603;
static const JSC::Intrinsic s_readableStreamConsumeReadableStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamConsumeReadableStreamCode = "(function (_,j,k){\"use strict\";const q=globalThis.Symbol.for(\"Bun.consumeReadableStreamPrototype\");var w=globalThis[q];if(!w)w=globalThis[q]=[];var x=w[j];if(x===@undefined){var[A,B,D,F,G,H]=globalThis[globalThis.Symbol.for(\"Bun.lazy\")](j);x=class J{handleError;handleClosed;processResult;constructor(K,L){this.#$=L,this.#j=K,this.#_=!1,this.handleError=this._handleError.bind(this),this.handleClosed=this._handleClosed.bind(this),this.processResult=this._processResult.bind(this),K.closed.then(this.handleClosed,this.handleError)}_handleClosed(){if(this.#_)return;this.#_=!0;var K=this.#$;this.#$=0,F(K),H(K)}_handleError(K){if(this.#_)return;this.#_=!0;var L=this.#$;this.#$=0,B(L,K),H(L)}#$;#_=!1;#j;_handleReadMany({value:K,done:L,size:N}){if(L){this.handleClosed();return}if(this.#_)return;D(this.#$,K,L,N)}read(){if(!this.#$)return @throwTypeError(\"ReadableStreamSink is already closed\");return this.processResult(this.#j.read())}_processResult(K){if(K&&@isPromise(K)){if(@getPromiseInternalField(K,@promiseFieldFlags)&@promiseStateFulfilled){const N=@getPromiseInternalField(K,@promiseFieldReactionsOrResult);if(N)K=N}}if(K&&@isPromise(K))return K.then(this.processResult,this.handleError),null;if(K.done)return this.handleClosed(),0;else if(K.value)return K.value;else return-1}readMany(){if(!this.#$)return @throwTypeError(\"ReadableStreamSink is already closed\");return this.processResult(this.#j.readMany())}};const I=j+1;if(w.length<I)w.length=I;@putByValDirect(w,j,x)}if(@isReadableStreamLocked(k))@throwTypeError(\"Cannot start reading from a locked stream\");return new x(k.getReader(),_)})\n";

// createEmptyReadableStream
const JSC::ConstructAbility s_readableStreamCreateEmptyReadableStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamCreateEmptyReadableStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamCreateEmptyReadableStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Private;
const int s_readableStreamCreateEmptyReadableStreamCodeLength = 99;
static const JSC::Intrinsic s_readableStreamCreateEmptyReadableStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamCreateEmptyReadableStreamCode = "(function (){\"use strict\";var d=new @ReadableStream({pull(){}});return @readableStreamClose(d),d})\n";

// createNativeReadableStream
const JSC::ConstructAbility s_readableStreamCreateNativeReadableStreamCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamCreateNativeReadableStreamCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamCreateNativeReadableStreamCodeImplementationVisibility = JSC::ImplementationVisibility::Private;
const int s_readableStreamCreateNativeReadableStreamCodeLength = 129;
static const JSC::Intrinsic s_readableStreamCreateNativeReadableStreamCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamCreateNativeReadableStreamCode = "(function (b,d,f){\"use strict\";return new @ReadableStream({@lazy:!0,@bunNativeType:d,@bunNativePtr:b,autoAllocateChunkSize:f})})\n";

// cancel
const JSC::ConstructAbility s_readableStreamCancelCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamCancelCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamCancelCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamCancelCodeLength = 266;
static const JSC::Intrinsic s_readableStreamCancelCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamCancelCode = "(function (u){\"use strict\";if(!@isReadableStream(this))return @Promise.@reject(@makeThisTypeError(\"ReadableStream\",\"cancel\"));if(@isReadableStreamLocked(this))return @Promise.@reject(@makeTypeError(\"ReadableStream is locked\"));return @readableStreamCancel(this,u)})\n";

// getReader
const JSC::ConstructAbility s_readableStreamGetReaderCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamGetReaderCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamGetReaderCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamGetReaderCodeLength = 470;
static const JSC::Intrinsic s_readableStreamGetReaderCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamGetReaderCode = "(function (e){\"use strict\";if(!@isReadableStream(this))throw @makeThisTypeError(\"ReadableStream\",\"getReader\");const n=@toDictionary(e,{},\"ReadableStream.getReader takes an object as first argument\").mode;if(n===@undefined){var b=@getByIdDirectPrivate(this,\"start\");if(b)@putByIdDirectPrivate(this,\"start\",@undefined),b();return new @ReadableStreamDefaultReader(this)}if(n==\"byob\")return new @ReadableStreamBYOBReader(this);@throwTypeError(\"Invalid mode is specified\")})\n";

// pipeThrough
const JSC::ConstructAbility s_readableStreamPipeThroughCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamPipeThroughCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamPipeThroughCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamPipeThroughCodeLength = 877;
static const JSC::Intrinsic s_readableStreamPipeThroughCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamPipeThroughCode = "(function (u,S){\"use strict\";const _=u,k=_[\"readable\"];if(!@isReadableStream(k))throw @makeTypeError(\"readable should be ReadableStream\");const I=_[\"writable\"],T=@getInternalWritableStream(I);if(!@isWritableStream(T))throw @makeTypeError(\"writable should be WritableStream\");let h=!1,j=!1,q=!1,x;if(!@isUndefinedOrNull(S)){if(!@isObject(S))throw @makeTypeError(\"options must be an object\");if(j=!!S[\"preventAbort\"],q=!!S[\"preventCancel\"],h=!!S[\"preventClose\"],x=S[\"signal\"],x!==@undefined&&!@isAbortSignal(x))throw @makeTypeError(\"options.signal must be AbortSignal\")}if(!@isReadableStream(this))throw @makeThisTypeError(\"ReadableStream\",\"pipeThrough\");if(@isReadableStreamLocked(this))throw @makeTypeError(\"ReadableStream is locked\");if(@isWritableStreamLocked(T))throw @makeTypeError(\"WritableStream is locked\");return @readableStreamPipeToWritableStream(this,T,h,j,q,x),k})\n";

// pipeTo
const JSC::ConstructAbility s_readableStreamPipeToCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamPipeToCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamPipeToCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamPipeToCodeLength = 926;
static const JSC::Intrinsic s_readableStreamPipeToCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamPipeToCode = "(function (_){\"use strict\";if(!@isReadableStream(this))return @Promise.@reject(@makeThisTypeError(\"ReadableStream\",\"pipeTo\"));if(@isReadableStreamLocked(this))return @Promise.@reject(@makeTypeError(\"ReadableStream is locked\"));let m=@argument(1),f=!1,j=!1,u=!1,B;if(!@isUndefinedOrNull(m)){if(!@isObject(m))return @Promise.@reject(@makeTypeError(\"options must be an object\"));try{j=!!m[\"preventAbort\"],u=!!m[\"preventCancel\"],f=!!m[\"preventClose\"],B=m[\"signal\"]}catch(W){return @Promise.@reject(W)}if(B!==@undefined&&!@isAbortSignal(B))return @Promise.@reject(@makeTypeError(\"options.signal must be AbortSignal\"))}const O=@getInternalWritableStream(_);if(!@isWritableStream(O))return @Promise.@reject(@makeTypeError(\"ReadableStream pipeTo requires a WritableStream\"));if(@isWritableStreamLocked(O))return @Promise.@reject(@makeTypeError(\"WritableStream is locked\"));return @readableStreamPipeToWritableStream(this,O,f,j,u,B)})\n";

// tee
const JSC::ConstructAbility s_readableStreamTeeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamTeeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamTeeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamTeeCodeLength = 140;
static const JSC::Intrinsic s_readableStreamTeeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamTeeCode = "(function (){\"use strict\";if(!@isReadableStream(this))throw @makeThisTypeError(\"ReadableStream\",\"tee\");return @readableStreamTee(this,!1)})\n";

// locked
const JSC::ConstructAbility s_readableStreamLockedCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamLockedCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamLockedCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamLockedCodeLength = 147;
static const JSC::Intrinsic s_readableStreamLockedCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamLockedCode = "(function (){\"use strict\";if(!@isReadableStream(this))throw @makeGetterTypeError(\"ReadableStream\",\"locked\");return @isReadableStreamLocked(this)})\n";

// values
const JSC::ConstructAbility s_readableStreamValuesCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamValuesCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamValuesCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamValuesCodeLength = 129;
static const JSC::Intrinsic s_readableStreamValuesCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamValuesCode = "(function (e){\"use strict\";var u=@ReadableStream.prototype;return @readableStreamDefineLazyIterators(u),u.values.@call(this,e)})\n";

// lazyAsyncIterator
const JSC::ConstructAbility s_readableStreamLazyAsyncIteratorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamLazyAsyncIteratorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamLazyAsyncIteratorCodeImplementationVisibility = JSC::ImplementationVisibility::Private;
const int s_readableStreamLazyAsyncIteratorCodeLength = 152;
static const JSC::Intrinsic s_readableStreamLazyAsyncIteratorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamLazyAsyncIteratorCode = "(function (){\"use strict\";var a=@ReadableStream.prototype;return @readableStreamDefineLazyIterators(a),a[globalThis.Symbol.asyncIterator].@call(this)})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().readableStreamBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().readableStreamBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_READABLESTREAM_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ReadableStreamDefaultController.ts */
// initializeReadableStreamDefaultController
const JSC::ConstructAbility s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCodeLength = 263;
static const JSC::Intrinsic s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCode = "(function (l,p,_,b){\"use strict\";if(arguments.length!==5&&arguments[4]!==@isReadableStream)@throwTypeError(\"ReadableStreamDefaultController constructor should not be called directly\");return @privateInitializeReadableStreamDefaultController.@call(this,l,p,_,b)})\n";

// enqueue
const JSC::ConstructAbility s_readableStreamDefaultControllerEnqueueCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamDefaultControllerEnqueueCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamDefaultControllerEnqueueCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultControllerEnqueueCodeLength = 356;
static const JSC::Intrinsic s_readableStreamDefaultControllerEnqueueCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamDefaultControllerEnqueueCode = "(function (r){\"use strict\";if(!@isReadableStreamDefaultController(this))throw @makeThisTypeError(\"ReadableStreamDefaultController\",\"enqueue\");if(!@readableStreamDefaultControllerCanCloseOrEnqueue(this))@throwTypeError(\"ReadableStreamDefaultController is not in a state where chunk can be enqueued\");return @readableStreamDefaultControllerEnqueue(this,r)})\n";

// error
const JSC::ConstructAbility s_readableStreamDefaultControllerErrorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamDefaultControllerErrorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamDefaultControllerErrorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultControllerErrorCodeLength = 188;
static const JSC::Intrinsic s_readableStreamDefaultControllerErrorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamDefaultControllerErrorCode = "(function (t){\"use strict\";if(!@isReadableStreamDefaultController(this))throw @makeThisTypeError(\"ReadableStreamDefaultController\",\"error\");@readableStreamDefaultControllerError(this,t)})\n";

// close
const JSC::ConstructAbility s_readableStreamDefaultControllerCloseCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamDefaultControllerCloseCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamDefaultControllerCloseCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultControllerCloseCodeLength = 337;
static const JSC::Intrinsic s_readableStreamDefaultControllerCloseCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamDefaultControllerCloseCode = "(function (){\"use strict\";if(!@isReadableStreamDefaultController(this))throw @makeThisTypeError(\"ReadableStreamDefaultController\",\"close\");if(!@readableStreamDefaultControllerCanCloseOrEnqueue(this))@throwTypeError(\"ReadableStreamDefaultController is not in a state where it can be closed\");@readableStreamDefaultControllerClose(this)})\n";

// desiredSize
const JSC::ConstructAbility s_readableStreamDefaultControllerDesiredSizeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableStreamDefaultControllerDesiredSizeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableStreamDefaultControllerDesiredSizeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableStreamDefaultControllerDesiredSizeCodeLength = 209;
static const JSC::Intrinsic s_readableStreamDefaultControllerDesiredSizeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableStreamDefaultControllerDesiredSizeCode = "(function (){\"use strict\";if(!@isReadableStreamDefaultController(this))throw @makeGetterTypeError(\"ReadableStreamDefaultController\",\"desiredSize\");return @readableStreamDefaultControllerGetDesiredSize(this)})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().readableStreamDefaultControllerBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().readableStreamDefaultControllerBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_READABLESTREAMDEFAULTCONTROLLER_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ReadableByteStreamInternals.ts */
// privateInitializeReadableByteStreamController
const JSC::ConstructAbility s_readableByteStreamInternalsPrivateInitializeReadableByteStreamControllerCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsPrivateInitializeReadableByteStreamControllerCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsPrivateInitializeReadableByteStreamControllerCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsPrivateInitializeReadableByteStreamControllerCodeLength = 1654;
static const JSC::Intrinsic s_readableByteStreamInternalsPrivateInitializeReadableByteStreamControllerCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsPrivateInitializeReadableByteStreamControllerCode = "(function (I,_,v){\"use strict\";if(!@isReadableStream(I))@throwTypeError(\"ReadableByteStreamController needs a ReadableStream\");if(@getByIdDirectPrivate(I,\"readableStreamController\")!==null)@throwTypeError(\"ReadableStream already has a controller\");@putByIdDirectPrivate(this,\"controlledReadableStream\",I),@putByIdDirectPrivate(this,\"underlyingByteSource\",_),@putByIdDirectPrivate(this,\"pullAgain\",!1),@putByIdDirectPrivate(this,\"pulling\",!1),@readableByteStreamControllerClearPendingPullIntos(this),@putByIdDirectPrivate(this,\"queue\",@newQueue()),@putByIdDirectPrivate(this,\"started\",0),@putByIdDirectPrivate(this,\"closeRequested\",!1);let D=@toNumber(v);if(@isNaN(D)||D<0)@throwRangeError(\"highWaterMark value is negative or not a number\");@putByIdDirectPrivate(this,\"strategyHWM\",D);let E=_.autoAllocateChunkSize;if(E!==@undefined){if(E=@toNumber(E),E<=0||E===@Infinity||E===-@Infinity)@throwRangeError(\"autoAllocateChunkSize value is negative or equal to positive or negative infinity\")}@putByIdDirectPrivate(this,\"autoAllocateChunkSize\",E),@putByIdDirectPrivate(this,\"pendingPullIntos\",@createFIFO());const b=this;return @promiseInvokeOrNoopNoCatch(@getByIdDirectPrivate(b,\"underlyingByteSource\"),\"start\",[b]).@then(()=>{@putByIdDirectPrivate(b,\"started\",1),@assert(!@getByIdDirectPrivate(b,\"pulling\")),@assert(!@getByIdDirectPrivate(b,\"pullAgain\")),@readableByteStreamControllerCallPullIfNeeded(b)},(f)=>{if(@getByIdDirectPrivate(I,\"state\")===@streamReadable)@readableByteStreamControllerError(b,f)}),@putByIdDirectPrivate(this,\"cancel\",@readableByteStreamControllerCancel),@putByIdDirectPrivate(this,\"pull\",@readableByteStreamControllerPull),this})\n";

// readableStreamByteStreamControllerStart
const JSC::ConstructAbility s_readableByteStreamInternalsReadableStreamByteStreamControllerStartCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableStreamByteStreamControllerStartCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableStreamByteStreamControllerStartCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableStreamByteStreamControllerStartCodeLength = 73;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableStreamByteStreamControllerStartCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableStreamByteStreamControllerStartCode = "(function (d){\"use strict\";@putByIdDirectPrivate(d,\"start\",@undefined)})\n";

// privateInitializeReadableStreamBYOBRequest
const JSC::ConstructAbility s_readableByteStreamInternalsPrivateInitializeReadableStreamBYOBRequestCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsPrivateInitializeReadableStreamBYOBRequestCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsPrivateInitializeReadableStreamBYOBRequestCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsPrivateInitializeReadableStreamBYOBRequestCodeLength = 139;
static const JSC::Intrinsic s_readableByteStreamInternalsPrivateInitializeReadableStreamBYOBRequestCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsPrivateInitializeReadableStreamBYOBRequestCode = "(function (a,s){\"use strict\";@putByIdDirectPrivate(this,\"associatedReadableByteStreamController\",a),@putByIdDirectPrivate(this,\"view\",s)})\n";

// isReadableByteStreamController
const JSC::ConstructAbility s_readableByteStreamInternalsIsReadableByteStreamControllerCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsIsReadableByteStreamControllerCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsIsReadableByteStreamControllerCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsIsReadableByteStreamControllerCodeLength = 100;
static const JSC::Intrinsic s_readableByteStreamInternalsIsReadableByteStreamControllerCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsIsReadableByteStreamControllerCode = "(function (u){\"use strict\";return @isObject(u)&&!!@getByIdDirectPrivate(u,\"underlyingByteSource\")})\n";

// isReadableStreamBYOBRequest
const JSC::ConstructAbility s_readableByteStreamInternalsIsReadableStreamBYOBRequestCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsIsReadableStreamBYOBRequestCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsIsReadableStreamBYOBRequestCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsIsReadableStreamBYOBRequestCodeLength = 118;
static const JSC::Intrinsic s_readableByteStreamInternalsIsReadableStreamBYOBRequestCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsIsReadableStreamBYOBRequestCode = "(function (m){\"use strict\";return @isObject(m)&&!!@getByIdDirectPrivate(m,\"associatedReadableByteStreamController\")})\n";

// isReadableStreamBYOBReader
const JSC::ConstructAbility s_readableByteStreamInternalsIsReadableStreamBYOBReaderCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsIsReadableStreamBYOBReaderCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsIsReadableStreamBYOBReaderCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsIsReadableStreamBYOBReaderCodeLength = 96;
static const JSC::Intrinsic s_readableByteStreamInternalsIsReadableStreamBYOBReaderCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsIsReadableStreamBYOBReaderCode = "(function (n){\"use strict\";return @isObject(n)&&!!@getByIdDirectPrivate(n,\"readIntoRequests\")})\n";

// readableByteStreamControllerCancel
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerCancelCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerCancelCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerCancelCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerCancelCodeLength = 248;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerCancelCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerCancelCode = "(function (d,B){\"use strict\";var _=@getByIdDirectPrivate(d,\"pendingPullIntos\"),b=_.peek();if(b)b.bytesFilled=0;return @putByIdDirectPrivate(d,\"queue\",@newQueue()),@promiseInvokeOrNoop(@getByIdDirectPrivate(d,\"underlyingByteSource\"),\"cancel\",[B])})\n";

// readableByteStreamControllerError
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerErrorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerErrorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerErrorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerErrorCodeLength = 316;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerErrorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerErrorCode = "(function (d,_){\"use strict\";@assert(@getByIdDirectPrivate(@getByIdDirectPrivate(d,\"controlledReadableStream\"),\"state\")===@streamReadable),@readableByteStreamControllerClearPendingPullIntos(d),@putByIdDirectPrivate(d,\"queue\",@newQueue()),@readableStreamError(@getByIdDirectPrivate(d,\"controlledReadableStream\"),_)})\n";

// readableByteStreamControllerClose
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerCloseCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerCloseCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerCloseCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerCloseCodeLength = 569;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerCloseCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerCloseCode = "(function (_){\"use strict\";if(@assert(!@getByIdDirectPrivate(_,\"closeRequested\")),@assert(@getByIdDirectPrivate(@getByIdDirectPrivate(_,\"controlledReadableStream\"),\"state\")===@streamReadable),@getByIdDirectPrivate(_,\"queue\").size>0){@putByIdDirectPrivate(_,\"closeRequested\",!0);return}var d=@getByIdDirectPrivate(_,\"pendingPullIntos\")\?.peek();if(d){if(d.bytesFilled>0){const s=@makeTypeError(\"Close requested while there remain pending bytes\");throw @readableByteStreamControllerError(_,s),s}}@readableStreamClose(@getByIdDirectPrivate(_,\"controlledReadableStream\"))})\n";

// readableByteStreamControllerClearPendingPullIntos
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerClearPendingPullIntosCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerClearPendingPullIntosCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerClearPendingPullIntosCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerClearPendingPullIntosCodeLength = 224;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerClearPendingPullIntosCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerClearPendingPullIntosCode = "(function (d){\"use strict\";@readableByteStreamControllerInvalidateBYOBRequest(d);var p=@getByIdDirectPrivate(d,\"pendingPullIntos\");if(p!==@undefined)p.clear();else @putByIdDirectPrivate(d,\"pendingPullIntos\",@createFIFO())})\n";

// readableByteStreamControllerGetDesiredSize
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerGetDesiredSizeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerGetDesiredSizeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerGetDesiredSizeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerGetDesiredSizeCodeLength = 272;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerGetDesiredSizeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerGetDesiredSizeCode = "(function (i){\"use strict\";const u=@getByIdDirectPrivate(i,\"controlledReadableStream\"),d=@getByIdDirectPrivate(u,\"state\");if(d===@streamErrored)return null;if(d===@streamClosed)return 0;return @getByIdDirectPrivate(i,\"strategyHWM\")-@getByIdDirectPrivate(i,\"queue\").size})\n";

// readableStreamHasBYOBReader
const JSC::ConstructAbility s_readableByteStreamInternalsReadableStreamHasBYOBReaderCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableStreamHasBYOBReaderCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableStreamHasBYOBReaderCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableStreamHasBYOBReaderCodeLength = 125;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableStreamHasBYOBReaderCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableStreamHasBYOBReaderCode = "(function (n){\"use strict\";const c=@getByIdDirectPrivate(n,\"reader\");return c!==@undefined&&@isReadableStreamBYOBReader(c)})\n";

// readableStreamHasDefaultReader
const JSC::ConstructAbility s_readableByteStreamInternalsReadableStreamHasDefaultReaderCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableStreamHasDefaultReaderCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableStreamHasDefaultReaderCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableStreamHasDefaultReaderCodeLength = 128;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableStreamHasDefaultReaderCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableStreamHasDefaultReaderCode = "(function (n){\"use strict\";const c=@getByIdDirectPrivate(n,\"reader\");return c!==@undefined&&@isReadableStreamDefaultReader(c)})\n";

// readableByteStreamControllerHandleQueueDrain
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerHandleQueueDrainCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerHandleQueueDrainCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerHandleQueueDrainCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerHandleQueueDrainCodeLength = 352;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerHandleQueueDrainCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerHandleQueueDrainCode = "(function (d){\"use strict\";if(@assert(@getByIdDirectPrivate(@getByIdDirectPrivate(d,\"controlledReadableStream\"),\"state\")===@streamReadable),!@getByIdDirectPrivate(d,\"queue\").size&&@getByIdDirectPrivate(d,\"closeRequested\"))@readableStreamClose(@getByIdDirectPrivate(d,\"controlledReadableStream\"));else @readableByteStreamControllerCallPullIfNeeded(d)})\n";

// readableByteStreamControllerPull
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerPullCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerPullCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerPullCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerPullCodeLength = 1005;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerPullCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerPullCode = "(function (_){\"use strict\";const d=@getByIdDirectPrivate(_,\"controlledReadableStream\");if(@assert(@readableStreamHasDefaultReader(d)),@getByIdDirectPrivate(_,\"queue\").content\?.isNotEmpty()){const h=@getByIdDirectPrivate(_,\"queue\").content.shift();@getByIdDirectPrivate(_,\"queue\").size-=h.byteLength,@readableByteStreamControllerHandleQueueDrain(_);let C;try{C=new @Uint8Array(h.buffer,h.byteOffset,h.byteLength)}catch(D){return @Promise.@reject(D)}return @createFulfilledPromise({value:C,done:!1})}if(@getByIdDirectPrivate(_,\"autoAllocateChunkSize\")!==@undefined){let h;try{h=@createUninitializedArrayBuffer(@getByIdDirectPrivate(_,\"autoAllocateChunkSize\"))}catch(D){return @Promise.@reject(D)}const C={buffer:h,byteOffset:0,byteLength:@getByIdDirectPrivate(_,\"autoAllocateChunkSize\"),bytesFilled:0,elementSize:1,ctor:@Uint8Array,readerType:\"default\"};@getByIdDirectPrivate(_,\"pendingPullIntos\").push(C)}const a=@readableStreamAddReadRequest(d);return @readableByteStreamControllerCallPullIfNeeded(_),a})\n";

// readableByteStreamControllerShouldCallPull
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerShouldCallPullCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerShouldCallPullCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerShouldCallPullCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerShouldCallPullCodeLength = 619;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerShouldCallPullCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerShouldCallPullCode = "(function (_){\"use strict\";const u=@getByIdDirectPrivate(_,\"controlledReadableStream\");if(@getByIdDirectPrivate(u,\"state\")!==@streamReadable)return!1;if(@getByIdDirectPrivate(_,\"closeRequested\"))return!1;if(!(@getByIdDirectPrivate(_,\"started\")>0))return!1;const f=@getByIdDirectPrivate(u,\"reader\");if(f&&(@getByIdDirectPrivate(f,\"readRequests\")\?.isNotEmpty()||!!@getByIdDirectPrivate(f,\"bunNativePtr\")))return!0;if(@readableStreamHasBYOBReader(u)&&@getByIdDirectPrivate(@getByIdDirectPrivate(u,\"reader\"),\"readIntoRequests\")\?.isNotEmpty())return!0;if(@readableByteStreamControllerGetDesiredSize(_)>0)return!0;return!1})\n";

// readableByteStreamControllerCallPullIfNeeded
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerCallPullIfNeededCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerCallPullIfNeededCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerCallPullIfNeededCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerCallPullIfNeededCodeLength = 670;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerCallPullIfNeededCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerCallPullIfNeededCode = "(function (i){\"use strict\";if(!@readableByteStreamControllerShouldCallPull(i))return;if(@getByIdDirectPrivate(i,\"pulling\")){@putByIdDirectPrivate(i,\"pullAgain\",!0);return}@assert(!@getByIdDirectPrivate(i,\"pullAgain\")),@putByIdDirectPrivate(i,\"pulling\",!0),@promiseInvokeOrNoop(@getByIdDirectPrivate(i,\"underlyingByteSource\"),\"pull\",[i]).@then(()=>{if(@putByIdDirectPrivate(i,\"pulling\",!1),@getByIdDirectPrivate(i,\"pullAgain\"))@putByIdDirectPrivate(i,\"pullAgain\",!1),@readableByteStreamControllerCallPullIfNeeded(i)},(_)=>{if(@getByIdDirectPrivate(@getByIdDirectPrivate(i,\"controlledReadableStream\"),\"state\")===@streamReadable)@readableByteStreamControllerError(i,_)})})\n";

// transferBufferToCurrentRealm
const JSC::ConstructAbility s_readableByteStreamInternalsTransferBufferToCurrentRealmCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsTransferBufferToCurrentRealmCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsTransferBufferToCurrentRealmCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsTransferBufferToCurrentRealmCodeLength = 38;
static const JSC::Intrinsic s_readableByteStreamInternalsTransferBufferToCurrentRealmCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsTransferBufferToCurrentRealmCode = "(function (n){\"use strict\";return n})\n";

// readableStreamReaderKind
const JSC::ConstructAbility s_readableByteStreamInternalsReadableStreamReaderKindCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableStreamReaderKindCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableStreamReaderKindCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableStreamReaderKindCodeLength = 188;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableStreamReaderKindCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableStreamReaderKindCode = "(function (n){\"use strict\";if(@getByIdDirectPrivate(n,\"readRequests\"))return @getByIdDirectPrivate(n,\"bunNativePtr\")\?3:1;if(@getByIdDirectPrivate(n,\"readIntoRequests\"))return 2;return 0})\n";

// readableByteStreamControllerEnqueue
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerEnqueueCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerEnqueueCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerEnqueueCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerEnqueueCodeLength = 1076;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerEnqueueCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerEnqueueCode = "(function (_,b){\"use strict\";const R=@getByIdDirectPrivate(_,\"controlledReadableStream\");switch(@assert(!@getByIdDirectPrivate(_,\"closeRequested\")),@assert(@getByIdDirectPrivate(R,\"state\")===@streamReadable),@getByIdDirectPrivate(R,\"reader\")\?@readableStreamReaderKind(@getByIdDirectPrivate(R,\"reader\")):0){case 1:{if(!@getByIdDirectPrivate(@getByIdDirectPrivate(R,\"reader\"),\"readRequests\")\?.isNotEmpty())@readableByteStreamControllerEnqueueChunk(_,@transferBufferToCurrentRealm(b.buffer),b.byteOffset,b.byteLength);else{@assert(!@getByIdDirectPrivate(_,\"queue\").content.size());const d=b.constructor===@Uint8Array\?b:new @Uint8Array(b.buffer,b.byteOffset,b.byteLength);@readableStreamFulfillReadRequest(R,d,!1)}break}case 2:{@readableByteStreamControllerEnqueueChunk(_,@transferBufferToCurrentRealm(b.buffer),b.byteOffset,b.byteLength),@readableByteStreamControllerProcessPullDescriptors(_);break}case 3:break;default:{@assert(!@isReadableStreamLocked(R)),@readableByteStreamControllerEnqueueChunk(_,@transferBufferToCurrentRealm(b.buffer),b.byteOffset,b.byteLength);break}}})\n";

// readableByteStreamControllerEnqueueChunk
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerEnqueueChunkCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerEnqueueChunkCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerEnqueueChunkCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerEnqueueChunkCodeLength = 160;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerEnqueueChunkCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerEnqueueChunkCode = "(function (d,_,a,i){\"use strict\";@getByIdDirectPrivate(d,\"queue\").content.push({buffer:_,byteOffset:a,byteLength:i}),@getByIdDirectPrivate(d,\"queue\").size+=i})\n";

// readableByteStreamControllerRespondWithNewView
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerRespondWithNewViewCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerRespondWithNewViewCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerRespondWithNewViewCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerRespondWithNewViewCodeLength = 417;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerRespondWithNewViewCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerRespondWithNewViewCode = "(function (_,d){\"use strict\";@assert(@getByIdDirectPrivate(_,\"pendingPullIntos\").isNotEmpty());let g=@getByIdDirectPrivate(_,\"pendingPullIntos\").peek();if(g.byteOffset+g.bytesFilled!==d.byteOffset)@throwRangeError(\"Invalid value for view.byteOffset\");if(g.byteLength!==d.byteLength)@throwRangeError(\"Invalid value for view.byteLength\");g.buffer=d.buffer,@readableByteStreamControllerRespondInternal(_,d.byteLength)})\n";

// readableByteStreamControllerRespond
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerRespondCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerRespondCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerRespondCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerRespondCodeLength = 251;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerRespondCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerRespondCode = "(function (_,p){\"use strict\";if(p=@toNumber(p),@isNaN(p)||p===@Infinity||p<0)@throwRangeError(\"bytesWritten has an incorrect value\");@assert(@getByIdDirectPrivate(_,\"pendingPullIntos\").isNotEmpty()),@readableByteStreamControllerRespondInternal(_,p)})\n";

// readableByteStreamControllerRespondInternal
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerRespondInternalCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerRespondInternalCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerRespondInternalCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerRespondInternalCodeLength = 464;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerRespondInternalCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerRespondInternalCode = "(function (_,d){\"use strict\";let u=@getByIdDirectPrivate(_,\"pendingPullIntos\").peek(),I=@getByIdDirectPrivate(_,\"controlledReadableStream\");if(@getByIdDirectPrivate(I,\"state\")===@streamClosed){if(d!==0)@throwTypeError(\"bytesWritten is different from 0 even though stream is closed\");@readableByteStreamControllerRespondInClosedState(_,u)}else @assert(@getByIdDirectPrivate(I,\"state\")===@streamReadable),@readableByteStreamControllerRespondInReadableState(_,d,u)})\n";

// readableByteStreamControllerRespondInReadableState
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerRespondInReadableStateCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerRespondInReadableStateCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerRespondInReadableStateCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerRespondInReadableStateCodeLength = 799;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerRespondInReadableStateCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerRespondInReadableStateCode = "(function (f,_,g){\"use strict\";if(g.bytesFilled+_>g.byteLength)@throwRangeError(\"bytesWritten value is too great\");if(@assert(@getByIdDirectPrivate(f,\"pendingPullIntos\").isEmpty()||@getByIdDirectPrivate(f,\"pendingPullIntos\").peek()===g),@readableByteStreamControllerInvalidateBYOBRequest(f),g.bytesFilled+=_,g.bytesFilled<g.elementSize)return;@readableByteStreamControllerShiftPendingDescriptor(f);const k=g.bytesFilled%g.elementSize;if(k>0){const E=g.byteOffset+g.bytesFilled,F=@cloneArrayBuffer(g.buffer,E-k,k);@readableByteStreamControllerEnqueueChunk(f,F,0,F.byteLength)}g.buffer=@transferBufferToCurrentRealm(g.buffer),g.bytesFilled-=k,@readableByteStreamControllerCommitDescriptor(@getByIdDirectPrivate(f,\"controlledReadableStream\"),g),@readableByteStreamControllerProcessPullDescriptors(f)})\n";

// readableByteStreamControllerRespondInClosedState
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerRespondInClosedStateCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerRespondInClosedStateCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerRespondInClosedStateCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerRespondInClosedStateCodeLength = 502;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerRespondInClosedStateCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerRespondInClosedStateCode = "(function (_,d){\"use strict\";if(d.buffer=@transferBufferToCurrentRealm(d.buffer),@assert(d.bytesFilled===0),@readableStreamHasBYOBReader(@getByIdDirectPrivate(_,\"controlledReadableStream\")))while(@getByIdDirectPrivate(@getByIdDirectPrivate(@getByIdDirectPrivate(_,\"controlledReadableStream\"),\"reader\"),\"readIntoRequests\")\?.isNotEmpty()){let g=@readableByteStreamControllerShiftPendingDescriptor(_);@readableByteStreamControllerCommitDescriptor(@getByIdDirectPrivate(_,\"controlledReadableStream\"),g)}})\n";

// readableByteStreamControllerProcessPullDescriptors
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerProcessPullDescriptorsCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerProcessPullDescriptorsCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerProcessPullDescriptorsCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerProcessPullDescriptorsCodeLength = 472;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerProcessPullDescriptorsCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerProcessPullDescriptorsCode = "(function (a){\"use strict\";@assert(!@getByIdDirectPrivate(a,\"closeRequested\"));while(@getByIdDirectPrivate(a,\"pendingPullIntos\").isNotEmpty()){if(@getByIdDirectPrivate(a,\"queue\").size===0)return;let d=@getByIdDirectPrivate(a,\"pendingPullIntos\").peek();if(@readableByteStreamControllerFillDescriptorFromQueue(a,d))@readableByteStreamControllerShiftPendingDescriptor(a),@readableByteStreamControllerCommitDescriptor(@getByIdDirectPrivate(a,\"controlledReadableStream\"),d)}})\n";

// readableByteStreamControllerFillDescriptorFromQueue
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerFillDescriptorFromQueueCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerFillDescriptorFromQueueCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerFillDescriptorFromQueueCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerFillDescriptorFromQueueCodeLength = 970;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerFillDescriptorFromQueueCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerFillDescriptorFromQueueCode = "(function (_,P){\"use strict\";const j=P.bytesFilled-P.bytesFilled%P.elementSize,k=@getByIdDirectPrivate(_,\"queue\").size<P.byteLength-P.bytesFilled\?@getByIdDirectPrivate(_,\"queue\").size:P.byteLength-P.bytesFilled,q=P.bytesFilled+k,v=q-q%P.elementSize;let w=k,z=!1;if(v>j)w=v-P.bytesFilled,z=!0;while(w>0){let E=@getByIdDirectPrivate(_,\"queue\").content.peek();const G=w<E.byteLength\?w:E.byteLength,H=P.byteOffset+P.bytesFilled;if(new @Uint8Array(P.buffer).set(new @Uint8Array(E.buffer,E.byteOffset,G),H),E.byteLength===G)@getByIdDirectPrivate(_,\"queue\").content.shift();else E.byteOffset+=G,E.byteLength-=G;@getByIdDirectPrivate(_,\"queue\").size-=G,@assert(@getByIdDirectPrivate(_,\"pendingPullIntos\").isEmpty()||@getByIdDirectPrivate(_,\"pendingPullIntos\").peek()===P),@readableByteStreamControllerInvalidateBYOBRequest(_),P.bytesFilled+=G,w-=G}if(!z)@assert(@getByIdDirectPrivate(_,\"queue\").size===0),@assert(P.bytesFilled>0),@assert(P.bytesFilled<P.elementSize);return z})\n";

// readableByteStreamControllerShiftPendingDescriptor
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerShiftPendingDescriptorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerShiftPendingDescriptorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerShiftPendingDescriptorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerShiftPendingDescriptorCodeLength = 150;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerShiftPendingDescriptorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerShiftPendingDescriptorCode = "(function (a){\"use strict\";let d=@getByIdDirectPrivate(a,\"pendingPullIntos\").shift();return @readableByteStreamControllerInvalidateBYOBRequest(a),d})\n";

// readableByteStreamControllerInvalidateBYOBRequest
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerInvalidateBYOBRequestCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerInvalidateBYOBRequestCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerInvalidateBYOBRequestCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerInvalidateBYOBRequestCodeLength = 308;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerInvalidateBYOBRequestCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerInvalidateBYOBRequestCode = "(function (_){\"use strict\";if(@getByIdDirectPrivate(_,\"byobRequest\")===@undefined)return;const d=@getByIdDirectPrivate(_,\"byobRequest\");@putByIdDirectPrivate(d,\"associatedReadableByteStreamController\",@undefined),@putByIdDirectPrivate(d,\"view\",@undefined),@putByIdDirectPrivate(_,\"byobRequest\",@undefined)})\n";

// readableByteStreamControllerCommitDescriptor
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerCommitDescriptorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerCommitDescriptorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerCommitDescriptorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerCommitDescriptorCodeLength = 386;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerCommitDescriptorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerCommitDescriptorCode = "(function (_,v){\"use strict\";@assert(@getByIdDirectPrivate(_,\"state\")!==@streamErrored);let y=!1;if(@getByIdDirectPrivate(_,\"state\")===@streamClosed)@assert(!v.bytesFilled),y=!0;let b=@readableByteStreamControllerConvertDescriptor(v);if(v.readerType===\"default\")@readableStreamFulfillReadRequest(_,b,y);else @assert(v.readerType===\"byob\"),@readableStreamFulfillReadIntoRequest(_,b,y)})\n";

// readableByteStreamControllerConvertDescriptor
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerConvertDescriptorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerConvertDescriptorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerConvertDescriptorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerConvertDescriptorCodeLength = 176;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerConvertDescriptorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerConvertDescriptorCode = "(function (a){\"use strict\";return @assert(a.bytesFilled<=a.byteLength),@assert(a.bytesFilled%a.elementSize===0),new a.ctor(a.buffer,a.byteOffset,a.bytesFilled/a.elementSize)})\n";

// readableStreamFulfillReadIntoRequest
const JSC::ConstructAbility s_readableByteStreamInternalsReadableStreamFulfillReadIntoRequestCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableStreamFulfillReadIntoRequestCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableStreamFulfillReadIntoRequestCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableStreamFulfillReadIntoRequestCodeLength = 161;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableStreamFulfillReadIntoRequestCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableStreamFulfillReadIntoRequestCode = "(function (g,b,f){\"use strict\";const i=@getByIdDirectPrivate(@getByIdDirectPrivate(g,\"reader\"),\"readIntoRequests\").shift();@fulfillPromise(i,{value:b,done:f})})\n";

// readableStreamBYOBReaderRead
const JSC::ConstructAbility s_readableByteStreamInternalsReadableStreamBYOBReaderReadCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableStreamBYOBReaderReadCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableStreamBYOBReaderReadCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableStreamBYOBReaderReadCodeLength = 356;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableStreamBYOBReaderReadCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableStreamBYOBReaderReadCode = "(function (n,c){\"use strict\";const p=@getByIdDirectPrivate(n,\"ownerReadableStream\");if(@assert(!!p),@putByIdDirectPrivate(p,\"disturbed\",!0),@getByIdDirectPrivate(p,\"state\")===@streamErrored)return @Promise.@reject(@getByIdDirectPrivate(p,\"storedError\"));return @readableByteStreamControllerPullInto(@getByIdDirectPrivate(p,\"readableStreamController\"),c)})\n";

// readableByteStreamControllerPullInto
const JSC::ConstructAbility s_readableByteStreamInternalsReadableByteStreamControllerPullIntoCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableByteStreamControllerPullIntoCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableByteStreamControllerPullIntoCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableByteStreamControllerPullIntoCodeLength = 1255;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableByteStreamControllerPullIntoCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableByteStreamControllerPullIntoCode = "(function (b,f){\"use strict\";const y=@getByIdDirectPrivate(b,\"controlledReadableStream\");let E=1;if(f.BYTES_PER_ELEMENT!==@undefined)E=f.BYTES_PER_ELEMENT;const P=f.constructor,_={buffer:f.buffer,byteOffset:f.byteOffset,byteLength:f.byteLength,bytesFilled:0,elementSize:E,ctor:P,readerType:\"byob\"};var a=@getByIdDirectPrivate(b,\"pendingPullIntos\");if(a\?.isNotEmpty())return _.buffer=@transferBufferToCurrentRealm(_.buffer),a.push(_),@readableStreamAddReadIntoRequest(y);if(@getByIdDirectPrivate(y,\"state\")===@streamClosed){const C=new P(_.buffer,_.byteOffset,0);return @createFulfilledPromise({value:C,done:!0})}if(@getByIdDirectPrivate(b,\"queue\").size>0){if(@readableByteStreamControllerFillDescriptorFromQueue(b,_)){const C=@readableByteStreamControllerConvertDescriptor(_);return @readableByteStreamControllerHandleQueueDrain(b),@createFulfilledPromise({value:C,done:!1})}if(@getByIdDirectPrivate(b,\"closeRequested\")){const C=@makeTypeError(\"Closing stream has been requested\");return @readableByteStreamControllerError(b,C),@Promise.@reject(C)}}_.buffer=@transferBufferToCurrentRealm(_.buffer),@getByIdDirectPrivate(b,\"pendingPullIntos\").push(_);const h=@readableStreamAddReadIntoRequest(y);return @readableByteStreamControllerCallPullIfNeeded(b),h})\n";

// readableStreamAddReadIntoRequest
const JSC::ConstructAbility s_readableByteStreamInternalsReadableStreamAddReadIntoRequestCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_readableByteStreamInternalsReadableStreamAddReadIntoRequestCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_readableByteStreamInternalsReadableStreamAddReadIntoRequestCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_readableByteStreamInternalsReadableStreamAddReadIntoRequestCodeLength = 326;
static const JSC::Intrinsic s_readableByteStreamInternalsReadableStreamAddReadIntoRequestCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_readableByteStreamInternalsReadableStreamAddReadIntoRequestCode = "(function (n){\"use strict\";@assert(@isReadableStreamBYOBReader(@getByIdDirectPrivate(n,\"reader\"))),@assert(@getByIdDirectPrivate(n,\"state\")===@streamReadable||@getByIdDirectPrivate(n,\"state\")===@streamClosed);const v=@newPromise();return @getByIdDirectPrivate(@getByIdDirectPrivate(n,\"reader\"),\"readIntoRequests\").push(v),v})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().readableByteStreamInternalsBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().readableByteStreamInternalsBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_READABLEBYTESTREAMINTERNALS_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* WritableStreamDefaultController.ts */
// initializeWritableStreamDefaultController
const JSC::ConstructAbility s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCodeLength = 368;
static const JSC::Intrinsic s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCode = "(function (){\"use strict\";return @putByIdDirectPrivate(this,\"queue\",@newQueue()),@putByIdDirectPrivate(this,\"abortSteps\",(t)=>{const _=@getByIdDirectPrivate(this,\"abortAlgorithm\").@call(@undefined,t);return @writableStreamDefaultControllerClearAlgorithms(this),_}),@putByIdDirectPrivate(this,\"errorSteps\",()=>{@resetQueue(@getByIdDirectPrivate(this,\"queue\"))}),this})\n";

// error
const JSC::ConstructAbility s_writableStreamDefaultControllerErrorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_writableStreamDefaultControllerErrorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_writableStreamDefaultControllerErrorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_writableStreamDefaultControllerErrorCodeLength = 301;
static const JSC::Intrinsic s_writableStreamDefaultControllerErrorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_writableStreamDefaultControllerErrorCode = "(function (i){\"use strict\";if(@getByIdDirectPrivate(this,\"abortSteps\")===@undefined)throw @makeThisTypeError(\"WritableStreamDefaultController\",\"error\");const t=@getByIdDirectPrivate(this,\"stream\");if(@getByIdDirectPrivate(t,\"state\")!==\"writable\")return;@writableStreamDefaultControllerError(this,i)})\n";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().writableStreamDefaultControllerBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().writableStreamDefaultControllerBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_WRITABLESTREAMDEFAULTCONTROLLER_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR



JSBuiltinInternalFunctions::JSBuiltinInternalFunctions(JSC::VM& vm)
    : m_vm(vm)
    , m_writableStreamInternals(vm)
    , m_transformStreamInternals(vm)
    , m_readableStreamInternals(vm)
    , m_streamInternals(vm)
    , m_readableByteStreamInternals(vm)

{
    UNUSED_PARAM(vm);
}

template<typename Visitor>
void JSBuiltinInternalFunctions::visit(Visitor& visitor)
{
    m_writableStreamInternals.visit(visitor);
    m_transformStreamInternals.visit(visitor);
    m_readableStreamInternals.visit(visitor);
    m_streamInternals.visit(visitor);
    m_readableByteStreamInternals.visit(visitor);

    UNUSED_PARAM(visitor);
}

template void JSBuiltinInternalFunctions::visit(AbstractSlotVisitor&);
template void JSBuiltinInternalFunctions::visit(SlotVisitor&);

SUPPRESS_ASAN void JSBuiltinInternalFunctions::initialize(Zig::GlobalObject& globalObject)
{
    UNUSED_PARAM(globalObject);
    m_writableStreamInternals.init(globalObject);
    m_transformStreamInternals.init(globalObject);
    m_readableStreamInternals.init(globalObject);
    m_streamInternals.init(globalObject);
    m_readableByteStreamInternals.init(globalObject);

    JSVMClientData& clientData = *static_cast<JSVMClientData*>(m_vm.clientData);
    Zig::GlobalObject::GlobalPropertyInfo staticGlobals[] = {
#define DECLARE_GLOBAL_STATIC(name) \
    Zig::GlobalObject::GlobalPropertyInfo( \
        clientData.builtinFunctions().writableStreamInternalsBuiltins().name##PrivateName(), writableStreamInternals().m_##name##Function.get() , JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly),
    WEBCORE_FOREACH_WRITABLESTREAMINTERNALS_BUILTIN_FUNCTION_NAME(DECLARE_GLOBAL_STATIC)
  #undef DECLARE_GLOBAL_STATIC
  #define DECLARE_GLOBAL_STATIC(name) \
    Zig::GlobalObject::GlobalPropertyInfo( \
        clientData.builtinFunctions().transformStreamInternalsBuiltins().name##PrivateName(), transformStreamInternals().m_##name##Function.get() , JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly),
    WEBCORE_FOREACH_TRANSFORMSTREAMINTERNALS_BUILTIN_FUNCTION_NAME(DECLARE_GLOBAL_STATIC)
  #undef DECLARE_GLOBAL_STATIC
  #define DECLARE_GLOBAL_STATIC(name) \
    Zig::GlobalObject::GlobalPropertyInfo( \
        clientData.builtinFunctions().readableStreamInternalsBuiltins().name##PrivateName(), readableStreamInternals().m_##name##Function.get() , JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly),
    WEBCORE_FOREACH_READABLESTREAMINTERNALS_BUILTIN_FUNCTION_NAME(DECLARE_GLOBAL_STATIC)
  #undef DECLARE_GLOBAL_STATIC
  #define DECLARE_GLOBAL_STATIC(name) \
    Zig::GlobalObject::GlobalPropertyInfo( \
        clientData.builtinFunctions().streamInternalsBuiltins().name##PrivateName(), streamInternals().m_##name##Function.get() , JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly),
    WEBCORE_FOREACH_STREAMINTERNALS_BUILTIN_FUNCTION_NAME(DECLARE_GLOBAL_STATIC)
  #undef DECLARE_GLOBAL_STATIC
  #define DECLARE_GLOBAL_STATIC(name) \
    Zig::GlobalObject::GlobalPropertyInfo( \
        clientData.builtinFunctions().readableByteStreamInternalsBuiltins().name##PrivateName(), readableByteStreamInternals().m_##name##Function.get() , JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly),
    WEBCORE_FOREACH_READABLEBYTESTREAMINTERNALS_BUILTIN_FUNCTION_NAME(DECLARE_GLOBAL_STATIC)
  #undef DECLARE_GLOBAL_STATIC
  
    };
    globalObject.addStaticGlobals(staticGlobals, std::size(staticGlobals));
    UNUSED_PARAM(clientData);
}

} // namespace WebCore
