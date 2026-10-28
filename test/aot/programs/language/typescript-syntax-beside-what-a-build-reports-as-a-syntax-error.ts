// @ts-nocheck
var a = 1;
export { a as "b c", a as if, a as default };
function withThis(this: any, x) { return x; }
class Accessors {
  get x(this: Accessors) { return 1; }
  set x(this: Accessors, v) { console.log("set", v); }
  method(this: Accessors, y) { return y; }
}
class Properties {
  constructor(public readonly p, readonly public q, public public r = 3, override s?) {}
}
class Merged { static own = 1; }
namespace Merged { export var added = 2; }
function merged() { return 3; }
namespace merged { export var added = 4; }
enum Twice { A }
enum Twice { B = 1 }
enum WithNamespace { A }
namespace WithNamespace { export var added = 5; }
namespace Empty {}
let Empty = 6;
namespace OnlyTypes { export type T = 1; export interface I {} }
const OnlyTypes = 7;
namespace Outer.Inner { export var deep = 8; }
namespace TypeExports { export type { T } from "x"; }
declare namespace Ambient { export default 1; import z = require("z"); }
declare enum AmbientEnum { A }
let AmbientEnum = 9;
function holdsGlobal() { declare global {} return 10; }
function newTarget() { enum E { A = new.target === undefined ? 1 : 2 } return E.A; }
enum Names { "quoted", "a-b" = 2, if, NaN }
import fs = require("node:fs");
let definite!: number;
class Modifiers { static public x = 11; readonly readonly y = 12; readonly m() { return 13; } }
for (var using of [14]) console.log(using);
const accessors = new Accessors();
accessors.x = 0;
const properties = new Properties(1, 2);
console.log(withThis(1), accessors.x, accessors.method(3), withThis.length);
console.log(properties.p, properties.q, properties.r, properties.s, Object.keys(properties).join());
console.log(Merged.own, Merged.added, merged(), merged.added, Twice.A, Twice.B, Twice[1], WithNamespace.A, WithNamespace.added);
console.log(Empty, OnlyTypes, Outer.Inner.deep, AmbientEnum, holdsGlobal(), newTarget(), typeof TypeExports);
console.log(Names.quoted, Names["a-b"], Names.if, Names.NaN, typeof fs.readFileSync, definite);
console.log(Modifiers.x, new Modifiers().y, new Modifiers().m());
