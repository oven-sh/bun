import { createRequire } from "node:module";
globalThis["require"] ??= createRequire(import.meta.url);
var t=(a=>typeof require<"u"?require:typeof Proxy<"u"?new Proxy(a,{get:(b,c)=>(typeof require<"u"?require:b)[c]}):a)(function(a){if(typeof require<"u")return require.apply(this,arguments);throw Error('Dynamic require of "'+a+'" is not supported')});
var v=(a,b)=>()=>{try{return b||a((b={exports:{}}).exports,b),b.exports}catch(c){throw b=0,c}};
export{t as c,v as e};
