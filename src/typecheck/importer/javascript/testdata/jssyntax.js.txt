import type { A } from "./a";
import { type B } from "./b";
export type { C } from "./c";
export { type D } from "./d";
import E = require("./e");
interface I {}
type T = number;
enum En {}
namespace Ns {}
declare var dv;
function f<T>(a?: number, public b): void {}
function sig();
var nn = dv!;
var as = dv as number;
var sat = dv satisfies number;
@d function fd() {}
class H extends Array<number> {}
/** @implements {J} */
class K<U> implements I {
  private p?: number;
  m?() {}
  [k: string]: number;
}
@dec export class Dec {}
export @dec2 class Dec2 {}
@a export @b class Both {}
export = f;
