import { early, late, peek } from "./b.js";
export class A {
  static #m() { return 1; }
  static m() { return A.#m; }
  static f() { return A.#f; }
  static put(v) { A.#f = v; return "stored"; }
  static has(v) { return typeof v === "function" && #f in v; }
  static hasMethod(v) { return typeof v === "function" && #m in v; }
  static { peek("half made", A); }
  static #f = 2;
  static { peek("made", A); }
}
export const E = class K { static #m() { return 2; } static m() { return K.#m; } };
console.log("read early from the other module: " + early);
late("behind");
late("again");
