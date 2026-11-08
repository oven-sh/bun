#!/usr/bin/env bun
// @bun
function  odd (a,b){return a+b}
const bare = a=>a, spaced = ( a , b )=>a, later = async a=>a;
class Kept { m (a){return a} static  s ( a ){return a} get  g (){return 1} }
const holder = { n (a){return a}, *made ( a ){yield a} };
const shown = [odd, bare, spaced, later, Kept, Kept.prototype.m, Kept.s, Object.getOwnPropertyDescriptor(Kept.prototype, "g").get, holder.n, holder.made];
for (const it of shown) console.log(JSON.stringify(String(it)));
