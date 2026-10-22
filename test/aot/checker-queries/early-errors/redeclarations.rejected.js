// A second declaration of a name that its scope, parameter list, class body or export list allows only once.
let a; let a;
let a; var a;
var a; let a;
const a = 1; function a() {}
class A {} class A {}
var both; function both() {}
function both() {} var both;
function both() {} { var both; }
{ function* f() {} function* f() {} }
{ async function f() {} async function f() {} }
{ function f() {} function* f() {} }
function f(a) { let a; }
function f(a, a) {}
(a, a) => 1;
function f(a, [a]) {}
({ m(a, a) {} });
try {} catch (e) { let e; }
try {} catch ([e, e]) {}
switch (0) { case 0: let a; case 1: let a; }
import * as a from "node:fs"; let a;
for (let i, i;;) {}
let [a, a] = [];
class C { #a; #a; }
class C { get #a() {} get #a() {} }
class C { static get #a() {} set #a(v) {} }
export const a = 1; export { a };
const a = 1, b = 2; export { a as c, b as c };
export default 1; export default 2;
