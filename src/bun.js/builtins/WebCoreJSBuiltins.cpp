#include "config.h"
#include "WebCoreJSBuiltins.h"

#include "WebCoreJSClientData.h"
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/ImplementationVisibility.h>
#include <JavaScriptCore/Intrinsic.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/VM.h>

namespace WebCore {

/* CountQueuingStrategy.ts */
// highWaterMark
const JSC::ConstructAbility s_CountQueuingStrategyhighWaterMarkCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_CountQueuingStrategyhighWaterMarkCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_CountQueuingStrategyhighWaterMarkCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_CountQueuingStrategyhighWaterMarkCodeLength = 203;
static const JSC::Intrinsic s_CountQueuingStrategyhighWaterMarkCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_CountQueuingStrategyhighWaterMarkCode = "(function(){\"use strict\";const d=@getByIdDirectPrivate(this,\"highWaterMark\");if(d===@undefined)@throwTypeError(\"CountQueuingStrategy.highWaterMark getter called on incompatible |this| value.\");return d})";

// size
const JSC::ConstructAbility s_CountQueuingStrategysizeCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_CountQueuingStrategysizeCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_CountQueuingStrategysizeCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_CountQueuingStrategysizeCodeLength = 35;
static const JSC::Intrinsic s_CountQueuingStrategysizeCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_CountQueuingStrategysizeCode = "(function(){return \"use strict\",1})";

// initializeCountQueuingStrategy
const JSC::ConstructAbility s_CountQueuingStrategyinitializeCountQueuingStrategyCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_CountQueuingStrategyinitializeCountQueuingStrategyCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_CountQueuingStrategyinitializeCountQueuingStrategyCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_CountQueuingStrategyinitializeCountQueuingStrategyCodeLength = 119;
static const JSC::Intrinsic s_CountQueuingStrategyinitializeCountQueuingStrategyCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_CountQueuingStrategyinitializeCountQueuingStrategyCode = "(function(n){\"use strict\",@putByIdDirectPrivate(this,\"highWaterMark\",@extractHighWaterMarkFromQueuingStrategyInit(n))})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().CountQueuingStrategyBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().CountQueuingStrategyBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* ConsoleObject.ts */
// asyncIterator
const JSC::ConstructAbility s_ConsoleObjectasyncIteratorCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_ConsoleObjectasyncIteratorCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_ConsoleObjectasyncIteratorCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_ConsoleObjectasyncIteratorCodeLength = 572;
static const JSC::Intrinsic s_ConsoleObjectasyncIteratorCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_ConsoleObjectasyncIteratorCode = "(function(){\"use strict\";const y=async function*P(){var j=Bun.stdin.stream().getReader(),q=new globalThis.TextDecoder(\"utf-8\",{fatal:!1}),w,z=Bun.indexOfLine;try{while(!0){var A,B,F;const K=j.readMany();if(@isPromise(K))({done:A,value:B}=await K);else({done:A,value:B}=K);if(A){if(F)yield q.decode(F);return}var G;for(let L of B){if(G=L,F)G=Buffer.concat([F,L]),F=null;var H=0,J=z(G,H);while(J!==-1)yield q.decode(G.subarray(H,J)),H=J+1,J=z(G,H);F=G.subarray(H)}}}catch(K){w=K}finally{if(j.releaseLock(),w)throw w}},D=globalThis.Symbol.asyncIterator;return this[D]=y,y()})";

// write
const JSC::ConstructAbility s_ConsoleObjectwriteCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_ConsoleObjectwriteCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_ConsoleObjectwriteCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_ConsoleObjectwriteCodeLength = 307;
static const JSC::Intrinsic s_ConsoleObjectwriteCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_ConsoleObjectwriteCode = "(function(a){\"use strict\";var d=@getByIdDirectPrivate(this,\"writer\");if(!d){var S=@toLength(a\?.length\?\?0);d=Bun.stdout.writer({highWaterMark:S>65536\?S:65536}),@putByIdDirectPrivate(this,\"writer\",d)}var _=d.write(a);const b=@argumentCount();for(var c=1;c<b;c++)_+=d.write(@argument(c));return d.flush(!0),_})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().ConsoleObjectBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().ConsoleObjectBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

/* BundlerPlugin.ts */
// runSetupFunction
const JSC::ConstructAbility s_BundlerPluginrunSetupFunctionCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_BundlerPluginrunSetupFunctionCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_BundlerPluginrunSetupFunctionCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_BundlerPluginrunSetupFunctionCodeLength = 2271;
static const JSC::Intrinsic s_BundlerPluginrunSetupFunctionCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_BundlerPluginrunSetupFunctionCode = "(function(w,E){\"use strict\";var T=new Map,_=new Map;function h(I,J,K){if(!I||!@isObject(I))@throwTypeError('Expected an object with \"filter\" RegExp');if(!J||!@isCallable(J))@throwTypeError(\"callback must be a function\");var{filter:M,namespace:N=\"file\"}=I;if(!M)@throwTypeError('Expected an object with \"filter\" RegExp');if(!@isRegExpObject(M))@throwTypeError(\"filter must be a RegExp\");if(N&&typeof N!==\"string\")@throwTypeError(\"namespace must be a string\");if((N\?.length\?\?0)===0)N=\"file\";if(!/^([/@a-zA-Z0-9_\\\\-]+)$/.test(N))@throwTypeError(\"namespace can only contain $a-zA-Z0-9_\\\\-\");var Q=K.@get(N);if(!Q)K.@set(N,[[M,J]]);else @arrayPush(Q,[M,J])}function q(I,J){h(I,J,T)}function z(I,J){h(I,J,_)}function A(I){@throwTypeError(\"On-start callbacks are not implemented yet. See https://github.com/oven-sh/bun/issues/2771\")}function B(I){@throwTypeError(\"On-end callbacks are not implemented yet. See https://github.com/oven-sh/bun/issues/2771\")}function C(I){@throwTypeError(\"On-dispose callbacks are not implemented yet. See https://github.com/oven-sh/bun/issues/2771\")}function F(I){@throwTypeError(\"build.resolve() is not implemented yet. See https://github.com/oven-sh/bun/issues/2771\")}const G=()=>{var I=!1,J=!1;for(var[K,M]of T.entries())for(var[N]of M)this.addFilter(N,K,1),I=!0;for(var[K,M]of _.entries())for(var[N]of M)this.addFilter(N,K,0),J=!0;if(J){var Q=this.onResolve;if(!Q)this.onResolve=_;else for(var[K,M]of _.entries()){var U=Q.@get(K);if(!U)Q.@set(K,M);else Q.@set(K,U.concat(M))}}if(I){var V=this.onLoad;if(!V)this.onLoad=T;else for(var[K,M]of T.entries()){var U=V.@get(K);if(!U)V.@set(K,M);else V.@set(K,U.concat(M))}}return I||J};var H=w({config:E,onDispose:C,onEnd:B,onLoad:q,onResolve:z,onStart:A,resolve:F,initialOptions:{...E,bundle:!0,entryPoints:E.entrypoints\?\?E.entryPoints\?\?[],minify:typeof E.minify===\"boolean\"\?E.minify:!1,minifyIdentifiers:E.minify===!0||E.minify\?.identifiers,minifyWhitespace:E.minify===!0||E.minify\?.whitespace,minifySyntax:E.minify===!0||E.minify\?.syntax,outbase:E.root,platform:E.target===\"bun\"\?\"node\":E.target},esbuild:{}});if(H&&@isPromise(H))if(@getPromiseInternalField(H,@promiseFieldFlags)&@promiseStateFulfilled)H=@getPromiseInternalField(H,@promiseFieldReactionsOrResult);else return H.@then(G);return G()})";

// runOnResolvePlugins
const JSC::ConstructAbility s_BundlerPluginrunOnResolvePluginsCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_BundlerPluginrunOnResolvePluginsCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_BundlerPluginrunOnResolvePluginsCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_BundlerPluginrunOnResolvePluginsCodeLength = 1708;
static const JSC::Intrinsic s_BundlerPluginrunOnResolvePluginsCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_BundlerPluginrunOnResolvePluginsCode = "(function(_,w,y,F,U){\"use strict\";const W=[\"entry-point\",\"import-statement\",\"require-call\",\"dynamic-import\",\"require-resolve\",\"import-rule\",\"url-token\",\"internal\"][U];var g=(async(j,q,v,z)=>{var{onResolve:A,onLoad:B}=this,C=A.@get(q);if(!C)return this.onResolveAsync(F,null,null,null),null;for(let[K,M]of C)if(K.test(j)){var E=M({path:j,importer:v,namespace:q,kind:z});while(E&&@isPromise(E)&&(@getPromiseInternalField(E,@promiseFieldFlags)&@promiseStateMask)===@promiseStateFulfilled)E=@getPromiseInternalField(E,@promiseFieldReactionsOrResult);if(E&&@isPromise(E))E=await E;if(!E||!@isObject(E))continue;var{path:G,namespace:H=q,external:J}=E;if(typeof G!==\"string\"||typeof H!==\"string\")@throwTypeError(\"onResolve plugins must return an object with a string 'path' and string 'loader' field\");if(!G)continue;if(!H)H=q;if(typeof J!==\"boolean\"&&!@isUndefinedOrNull(J))@throwTypeError('onResolve plugins \"external\" field must be boolean or unspecified');if(!J){if(H===\"file\"){if(linux!==\"win32\"){if(G[0]!==\"/\"||G.includes(\"..\"))@throwTypeError('onResolve plugin \"path\" must be absolute when the namespace is \"file\"')}}if(H===\"dataurl\"){if(!G.startsWith(\"data:\"))@throwTypeError('onResolve plugin \"path\" must start with \"data:\" when the namespace is \"dataurl\"')}if(H&&H!==\"file\"&&(!B||!B.@has(H)))@throwTypeError(`Expected onLoad plugin for namespace ${H} to exist`)}return this.onResolveAsync(F,G,H,J),null}return this.onResolveAsync(F,null,null,null),null})(_,w,y,W);while(g&&@isPromise(g)&&(@getPromiseInternalField(g,@promiseFieldFlags)&@promiseStateMask)===@promiseStateFulfilled)g=@getPromiseInternalField(g,@promiseFieldReactionsOrResult);if(g&&@isPromise(g))g.then(()=>{},(j)=>{this.addError(F,j,0)})})";

// runOnLoadPlugins
const JSC::ConstructAbility s_BundlerPluginrunOnLoadPluginsCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_BundlerPluginrunOnLoadPluginsCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_BundlerPluginrunOnLoadPluginsCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_BundlerPluginrunOnLoadPluginsCodeLength = 1328;
static const JSC::Intrinsic s_BundlerPluginrunOnLoadPluginsCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_BundlerPluginrunOnLoadPluginsCode = "(function(_,g,F,S){\"use strict\";const T={jsx:0,js:1,ts:2,tsx:3,css:4,file:5,json:6,toml:7,wasm:8,napi:9,base64:10,dataurl:11,text:12},j=[\"jsx\",\"js\",\"ts\",\"tsx\",\"css\",\"file\",\"json\",\"toml\",\"wasm\",\"napi\",\"base64\",\"dataurl\",\"text\"][S];var q=(async(v,w,x,y)=>{var z=this.onLoad.@get(x);if(!z)return this.onLoadAsync(v,null,null,null),null;for(let[H,J]of z)if(H.test(w)){var B=J({path:w,namespace:x,loader:y});while(B&&@isPromise(B)&&(@getPromiseInternalField(B,@promiseFieldFlags)&@promiseStateMask)===@promiseStateFulfilled)B=@getPromiseInternalField(B,@promiseFieldReactionsOrResult);if(B&&@isPromise(B))B=await B;if(!B||!@isObject(B))continue;var{contents:C,loader:G=y}=B;if(typeof C!==\"string\"&&!@isTypedArrayView(C))@throwTypeError('onLoad plugins must return an object with \"contents\" as a string or Uint8Array');if(typeof G!==\"string\")@throwTypeError('onLoad plugins must return an object with \"loader\" as a string');const K=T[G];if(K===@undefined)@throwTypeError(`Loader ${G} is not supported.`);return this.onLoadAsync(v,C,K),null}return this.onLoadAsync(v,null,null),null})(_,g,F,j);while(q&&@isPromise(q)&&(@getPromiseInternalField(q,@promiseFieldFlags)&@promiseStateMask)===@promiseStateFulfilled)q=@getPromiseInternalField(q,@promiseFieldReactionsOrResult);if(q&&@isPromise(q))q.then(()=>{},(v)=>{this.addError(_,v,1)})})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().BundlerPluginBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().BundlerPluginBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR


} // namespace WebCore
