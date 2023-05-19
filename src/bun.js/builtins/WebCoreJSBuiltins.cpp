#include "config.h"
#include "WebCoreJSBuiltins.h"

#include "WebCoreJSClientData.h"
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/ImplementationVisibility.h>
#include <JavaScriptCore/Intrinsic.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/VM.h>

namespace WebCore {

/* BundlerPlugin.ts */
// runSetupFunction
const JSC::ConstructAbility s_BundlerPluginRunSetupFunctionCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_BundlerPluginRunSetupFunctionCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_BundlerPluginRunSetupFunctionCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_BundlerPluginRunSetupFunctionCodeLength = 2268;
static const JSC::Intrinsic s_BundlerPluginRunSetupFunctionCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_BundlerPluginRunSetupFunctionCode = "(function(_,h){\"use strict\";var C=new Map,T=new Map;function q(J,K,M){if(!J||!@isObject(J))@throwTypeError('Expected an object with \"filter\" RegExp');if(!K||!@isCallable(K))@throwTypeError(\"callback must be a function\");var{filter:N,namespace:Q=\"file\"}=J;if(!N)@throwTypeError('Expected an object with \"filter\" RegExp');if(!@isRegExpObject(N))@throwTypeError(\"filter must be a RegExp\");if(Q&&typeof Q!==\"string\")@throwTypeError(\"namespace must be a string\");if((Q\?.length\?\?0)===0)Q=\"file\";if(!/^([/@a-zA-Z0-9_\\\\-]+)$/.test(Q))@throwTypeError(\"namespace can only contain $a-zA-Z0-9_\\\\-\");var U=M.@get(Q);if(!U)M.@set(Q,[[N,K]]);else @arrayPush(U,[N,K])}function w(J,K){q(J,K,C)}function z(J,K){q(J,K,T)}function A(J){@throwTypeError(\"On-start callbacks is not implemented yet. See https://github.com/oven-sh/bun/issues/2771\")}function B(J){@throwTypeError(\"On-end callbacks is not implemented yet. See https://github.com/oven-sh/bun/issues/2771\")}function F(J){@throwTypeError(\"On-dispose callbacks is not implemented yet. See https://github.com/oven-sh/bun/issues/2771\")}function G(J){@throwTypeError(\"build.resolve() is not implemented yet. See https://github.com/oven-sh/bun/issues/2771\")}const H=()=>{var J=!1,K=!1;for(var[M,N]of C.entries())for(var[Q]of N)this.addFilter(Q,M,1),J=!0;for(var[M,N]of T.entries())for(var[Q]of N)this.addFilter(Q,M,0),K=!0;if(K){var U=this.onResolve;if(!U)this.onResolve=T;else for(var[M,N]of T.entries()){var V=U.@get(M);if(!V)U.@set(M,N);else U.@set(M,V.concat(N))}}if(J){var W=this.onLoad;if(!W)this.onLoad=C;else for(var[M,N]of C.entries()){var V=W.@get(M);if(!V)W.@set(M,N);else W.@set(M,V.concat(N))}}return J||K};var I=_({config:h,onDispose:F,onEnd:B,onLoad:w,onResolve:z,onStart:A,resolve:G,initialOptions:{...h,bundle:!0,entryPoints:h.entrypoints\?\?h.entryPoints\?\?[],minify:typeof h.minify===\"boolean\"\?h.minify:!1,minifyIdentifiers:h.minify===!0||h.minify\?.identifiers,minifyWhitespace:h.minify===!0||h.minify\?.whitespace,minifySyntax:h.minify===!0||h.minify\?.syntax,outbase:h.root,platform:h.target===\"bun\"\?\"node\":h.target},esbuild:{}});if(I&&@isPromise(I))if(@getPromiseInternalField(I,@promiseFieldFlags)&@promiseStateFulfilled)I=@getPromiseInternalField(I,@promiseFieldReactionsOrResult);else return I.@then(H);return H()})";

// runOnResolvePlugins
const JSC::ConstructAbility s_BundlerPluginRunOnResolvePluginsCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_BundlerPluginRunOnResolvePluginsCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_BundlerPluginRunOnResolvePluginsCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_BundlerPluginRunOnResolvePluginsCodeLength = 1708;
static const JSC::Intrinsic s_BundlerPluginRunOnResolvePluginsCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_BundlerPluginRunOnResolvePluginsCode = "(function(_,w,M,b,g){\"use strict\";const j=[\"entry-point\",\"import-statement\",\"require-call\",\"dynamic-import\",\"require-resolve\",\"import-rule\",\"url-token\",\"internal\"][g];var q=(async(y,z,A,B)=>{var{onResolve:C,onLoad:E}=this,F=C.@get(z);if(!F)return this.onResolveAsync(b,null,null,null),null;for(let[O,Q]of F)if(O.test(y)){var G=Q({path:y,importer:A,namespace:z,kind:B});while(G&&@isPromise(G)&&(@getPromiseInternalField(G,@promiseFieldFlags)&@promiseStateMask)===@promiseStateFulfilled)G=@getPromiseInternalField(G,@promiseFieldReactionsOrResult);if(G&&@isPromise(G))G=await G;if(!G||!@isObject(G))continue;var{path:H,namespace:J=z,external:K}=G;if(typeof H!==\"string\"||typeof J!==\"string\")@throwTypeError(\"onResolve plugins must return an object with a string 'path' and string 'loader' field\");if(!H)continue;if(!J)J=z;if(typeof K!==\"boolean\"&&!@isUndefinedOrNull(K))@throwTypeError('onResolve plugins \"external\" field must be boolean or unspecified');if(!K){if(J===\"file\"){if(linux!==\"win32\"){if(H[0]!==\"/\"||H.includes(\"..\"))@throwTypeError('onResolve plugin \"path\" must be absolute when the namespace is \"file\"')}}if(J===\"dataurl\"){if(!H.startsWith(\"data:\"))@throwTypeError('onResolve plugin \"path\" must start with \"data:\" when the namespace is \"dataurl\"')}if(J&&J!==\"file\"&&(!E||!E.@has(J)))@throwTypeError(`Expected onLoad plugin for namespace ${J} to exist`)}return this.onResolveAsync(b,H,J,K),null}return this.onResolveAsync(b,null,null,null),null})(_,w,M,j);while(q&&@isPromise(q)&&(@getPromiseInternalField(q,@promiseFieldFlags)&@promiseStateMask)===@promiseStateFulfilled)q=@getPromiseInternalField(q,@promiseFieldReactionsOrResult);if(q&&@isPromise(q))q.then(()=>{},(y)=>{this.addError(b,y,0)})})";

// runOnLoadPlugins
const JSC::ConstructAbility s_BundlerPluginRunOnLoadPluginsCodeConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_BundlerPluginRunOnLoadPluginsCodeConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_BundlerPluginRunOnLoadPluginsCodeImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_BundlerPluginRunOnLoadPluginsCodeLength = 1328;
static const JSC::Intrinsic s_BundlerPluginRunOnLoadPluginsCodeIntrinsic = JSC::NoIntrinsic;
const char* const s_BundlerPluginRunOnLoadPluginsCode = "(function(j,_,g,q){\"use strict\";const v={jsx:0,js:1,ts:2,tsx:3,css:4,file:5,json:6,toml:7,wasm:8,napi:9,base64:10,dataurl:11,text:12},w=[\"jsx\",\"js\",\"ts\",\"tsx\",\"css\",\"file\",\"json\",\"toml\",\"wasm\",\"napi\",\"base64\",\"dataurl\",\"text\"][q];var x=(async(y,z,B,C)=>{var F=this.onLoad.@get(B);if(!F)return this.onLoadAsync(y,null,null,null),null;for(let[K,O]of F)if(K.test(z)){var G=O({path:z,namespace:B,loader:C});while(G&&@isPromise(G)&&(@getPromiseInternalField(G,@promiseFieldFlags)&@promiseStateMask)===@promiseStateFulfilled)G=@getPromiseInternalField(G,@promiseFieldReactionsOrResult);if(G&&@isPromise(G))G=await G;if(!G||!@isObject(G))continue;var{contents:H,loader:J=C}=G;if(typeof H!==\"string\"&&!@isTypedArrayView(H))@throwTypeError('onLoad plugins must return an object with \"contents\" as a string or Uint8Array');if(typeof J!==\"string\")@throwTypeError('onLoad plugins must return an object with \"loader\" as a string');const Q=v[J];if(Q===@undefined)@throwTypeError(`Loader ${J} is not supported.`);return this.onLoadAsync(y,H,Q),null}return this.onLoadAsync(y,null,null),null})(j,_,g,w);while(x&&@isPromise(x)&&(@getPromiseInternalField(x,@promiseFieldFlags)&@promiseStateMask)===@promiseStateFulfilled)x=@getPromiseInternalField(x,@promiseFieldReactionsOrResult);if(x&&@isPromise(x))x.then(()=>{},(y)=>{this.addError(j,y,1)})})";

#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \
{\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \
    return clientData->builtinFunctions().BundlerPluginBuiltins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().BundlerPluginBuiltins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \
}
WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR


} // namespace WebCore
