"use strict";
"other directive";
;
var a = 1, b;
let c = 2;
const d = 3, { e, f: g = 4, ...h } = o, [i, , j = 5, ...k] = arr;
if (a) b; else if (c) { d; } else ;
do x(); while (y)
while (y) x();
for (var i = 0; i < 10; i++) {}
for (;;) {}
for (const k in o) {}
for (x of xs) {}
for (let [a1, b1] of xs) ;
lbl: for (;;) { break lbl; continue lbl; }
switch (a) { case 1: x(); break; default: y(); case 2: }
try { a(); } catch (e) { b(); } finally { c(); }
try { a(); } catch { b(); }
throw new Error("x");
debugger;
function fn(a, b = 1, ...c) { return a; }
async function afn() { await a; for await (const x of y) {} }
function* gfn() { yield; yield 1; yield* g(); }
class C {}
class D extends C { x = 1; static y; method() {} }
{ a; }
with (o) { p; }
export {};
