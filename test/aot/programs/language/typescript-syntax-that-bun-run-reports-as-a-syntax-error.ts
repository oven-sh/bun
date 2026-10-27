// @ts-nocheck
export { if };
export { "a" };
export { this as b };
var c;
export { c as #d };
var arrow1 = (this) => 1;
var arrow2 = (a, this: any) => 1;
class Setter { set x(this) {} }
function f1(public a) {}
var f2 = (readonly a) => 1;
class M1 { m(private a) {} }
class M2 { static constructor(public a) {} }
class P1 { constructor(public ...a) {} }
class P2 { constructor(public { a }) {} }
class P3 { constructor(static a) {} }
class P4 { constructor(public constructor) {} }
public var v1;
abstract function f3() {}
readonly class C1 {}
@dec var v2;
@dec function f4() {}
class D1 { @dec constructor() {} }
class D2 { @dec static {} }
function f5(@dec a) {}
class K1 { const x = 1; }
class K2 { in x; }
{ namespace N1 {} }
function f6() { namespace N2 { var a = 1; } }
label1: namespace N3 {}
if (1) import i1 = require("node:fs");
{ export = 1; }
function f7() { export as namespace X; }
module "m1" {}
global {}
namespace N4 { import a from "x"; }
namespace N5 { export * from "x"; }
namespace N6 { export default 1; }
enum E1 { 1 }
enum E2 { [k] }
enum E3 { #a }
enum E4 { A, A }
enum E5 { A } let E5;
var E6; enum E6 { A }
namespace N7 { var a = 1; } let N7;
namespace N8 { var a = 1; } class N8 {}
namespace N9 { export var a = 1; } function N9() {}
import i2 = require("node:fs"); import i2 = require("node:fs");
import i3 = require("node:fs"); let i3;
namespace N10 { this; }
enum E7 { A = this }
namespace N11 { new.target; }
enum E8 { A = new.target }
enum eval {}
namespace arguments { var a = 1; }
let x1!;
function dec(...a) {}
console.log("ran");
