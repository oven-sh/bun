// `typeof` of every kind of value compared with every type name, in both operand orders, with `===` and `==`.
// @ts-ignore
import { increments } from "./increments.js";
declare const console: any;
const log: any[] = [];
class C {}
const withProperty: any = () => 1; withProperty.p = 1;
const values: any[] = [undefined, null, true, false, 0, 1.5, NaN, "", "s", Symbol.iterator, 10n, {}, [], () => 1, function () {}, C, withProperty, async () => 1, function* () {},
  Math.max, (() => 1).bind(null), new Proxy(function () {}, {}), new Proxy({}, {}), /x/, new Date(0), Object.create(null), new Map(), Promise.resolve(1), new C(), new Uint8Array(1)];
for (const v of values) {
  let s = "";
  s += typeof v === "undefined" ? "U" : "-";
  s += typeof v === "object" ? "O" : "-";
  s += typeof v === "function" ? "F" : "-";
  s += typeof v === "string" ? "S" : "-";
  s += typeof v === "number" ? "N" : "-";
  s += typeof v === "boolean" ? "B" : "-";
  s += typeof v === "symbol" ? "Y" : "-";
  s += typeof v === "bigint" ? "I" : "-";
  s += "function" === typeof v ? "f" : "-";
  s += typeof v == "object" ? "o" : "-";
  s += typeof v !== "function" ? "-" : "f";
  s += typeof v != "undefined" ? "-" : "u";
  s += (typeof v as string) === "Function" ? "!" : "-";
  s += (typeof v as string) === "" ? "!" : "-";
  const t = typeof v;
  s += " " + t + " " + (t === "function") + " " + t.length;
  log.push(s);
}
declare const notDeclared: any;
log.push(typeof notDeclared === "undefined", typeof notDeclared === "function");
log.push(increments().join(" "));
console.log(log.map(String).join("\n"));
export {};
