// Making `this` has no position of its own: an error out of reading the prototype of new.target is reported at the first position that the constructor records.
// Here: names that are imported, require, import.meta and the names of the file.
import { EventEmitter } from "node:events";
import * as ns from "node:path";
import path, { join } from "node:path";
function f() {
  return 0;
}
const g = { x: 1, l: [] };
class C2 {}
var p = 1;
function column(A) {
  const given = { __proto__: A.prototype };
  const B = new Proxy(A, { get: (t, k) => (k === "prototype" ? given : t[k]) });
  try {
    new B();
  } catch (error) {
    console.log(error.stack.split("\n").find(line => line.includes("new A")).replace(/.*[\\/]/, ""));
  }
}
column(class A { constructor(a) { this.t = join; } });
column(class A { constructor(a) { this.t = join("a", a); } });
column(class A { constructor(a) { this.t = [join]; } });
column(class A { constructor(a) { this.t = { join }; } });
column(class A { constructor(a) { this.t = path.sep; } });
column(class A { constructor(a) { this.t = path.join("a"); } });
column(class A { constructor(a) { this.t = new EventEmitter(); } });
column(class A { constructor(a) { this.t = ns.sep; } });
column(class A { constructor(a) { this.t = ns; } });
column(class A { constructor(a) { this.t = typeof join; f(); } });
column(class A { constructor(a) { this.t = require("node:fs"); } });
column(class A { constructor(a) { this.t = require("node:fs").existsSync; } });
column(class A { constructor(a) { this.t = require.resolve("node:fs"); } });
column(class A { constructor(a) { this.t = require; } });
column(class A { constructor(a) { this.t = [require]; } });
column(class A { constructor(a) { this.t = require(a); } });
column(class A { constructor(a) { this.t = import.meta.main; f(); } });
column(class A { constructor(a) { this.t = import.meta.require; f(); } });
column(class A { constructor(a) { this.t = [import.meta]; f(); } });
column(class A { constructor(a) { this.t = Bun.version; f(); } });
column(class A { constructor(a) { this.t = globalThis.x; f(); } });
column(class A { constructor(a) { this.t = Symbol.iterator; f(); } });
column(class A { constructor(a) { this.t = __dirname; f(); } });
column(class A { constructor(a) { this.t = __filename; f(); } });
