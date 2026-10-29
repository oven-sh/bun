// The other arm of each test requires a file that is not there: a build that followed it would report it.
// RUN: lower

var c0 = typeof Bun !== "undefined";
class C0 {
  m() {
    return () => (c0 ? 0 : require("./for-another-runtime-0.js"));
  }
}
console.log(new C0().m()());
var c1 = typeof Bun != "undefined";
class C1 {
  m() {
    return () => (c1 ? 1 : require("./for-another-runtime-1.js"));
  }
}
console.log(new C1().m()());
var c2 = "undefined" !== typeof Bun;
class C2 {
  m() {
    return () => (c2 ? 2 : require("./for-another-runtime-2.js"));
  }
}
console.log(new C2().m()());
var c3 = typeof Bun === "object";
class C3 {
  m() {
    return () => (c3 ? 3 : require("./for-another-runtime-3.js"));
  }
}
console.log(new C3().m()());
var c4 = globalThis.Bun;
class C4 {
  m() {
    return () => (c4 ? 4 : require("./for-another-runtime-4.js"));
  }
}
console.log(new C4().m()());
var c5 = globalThis.Bun !== undefined;
class C5 {
  m() {
    return () => (c5 ? 5 : require("./for-another-runtime-5.js"));
  }
}
console.log(new C5().m()());
var c6 = typeof globalThis.Bun !== "undefined";
class C6 {
  m() {
    return () => (c6 ? 6 : require("./for-another-runtime-6.js"));
  }
}
console.log(new C6().m()());
var c7 = "Bun" in globalThis;
class C7 {
  m() {
    return () => (c7 ? 7 : require("./for-another-runtime-7.js"));
  }
}
console.log(new C7().m()());
var c8 = globalThis?.Bun;
class C8 {
  m() {
    return () => (c8 ? 8 : require("./for-another-runtime-8.js"));
  }
}
console.log(new C8().m()());
var c9 = globalThis.Bun != null;
class C9 {
  m() {
    return () => (c9 ? 9 : require("./for-another-runtime-9.js"));
  }
}
console.log(new C9().m()());
var c10 = typeof process !== "undefined";
class C10 {
  m() {
    return () => (c10 ? 10 : require("./for-another-runtime-10.js"));
  }
}
console.log(new C10().m()());
var c11 = typeof process === "object";
class C11 {
  m() {
    return () => (c11 ? 11 : require("./for-another-runtime-11.js"));
  }
}
console.log(new C11().m()());
var c12 = globalThis.process;
class C12 {
  m() {
    return () => (c12 ? 12 : require("./for-another-runtime-12.js"));
  }
}
console.log(new C12().m()());
var c13 = globalThis.process !== undefined;
class C13 {
  m() {
    return () => (c13 ? 13 : require("./for-another-runtime-13.js"));
  }
}
console.log(new C13().m()());
var c14 = "process" in globalThis;
class C14 {
  m() {
    return () => (c14 ? 14 : require("./for-another-runtime-14.js"));
  }
}
console.log(new C14().m()());
var c15 = process.isBun;
class C15 {
  m() {
    return () => (c15 ? 15 : require("./for-another-runtime-15.js"));
  }
}
console.log(new C15().m()());
var c16 = process.isBun === true;
class C16 {
  m() {
    return () => (c16 ? 16 : require("./for-another-runtime-16.js"));
  }
}
console.log(new C16().m()());
var c17 = process?.isBun;
class C17 {
  m() {
    return () => (c17 ? 17 : require("./for-another-runtime-17.js"));
  }
}
console.log(new C17().m()());
var c18 = "isBun" in process;
class C18 {
  m() {
    return () => (c18 ? 18 : require("./for-another-runtime-18.js"));
  }
}
console.log(new C18().m()());
var c19 = typeof process.versions === "object";
class C19 {
  m() {
    return () => (c19 ? 19 : require("./for-another-runtime-19.js"));
  }
}
console.log(new C19().m()());
var c20 = process.versions !== null;
class C20 {
  m() {
    return () => (c20 ? 20 : require("./for-another-runtime-20.js"));
  }
}
console.log(new C20().m()());
var c21 = process.versions != null;
class C21 {
  m() {
    return () => (c21 ? 21 : require("./for-another-runtime-21.js"));
  }
}
console.log(new C21().m()());
var c22 = "versions" in process;
class C22 {
  m() {
    return () => (c22 ? 22 : require("./for-another-runtime-22.js"));
  }
}
console.log(new C22().m()());
var c23 = process.versions.bun;
class C23 {
  m() {
    return () => (c23 ? 23 : require("./for-another-runtime-23.js"));
  }
}
console.log(new C23().m()());
var c24 = process.versions.bun !== undefined;
class C24 {
  m() {
    return () => (c24 ? 24 : require("./for-another-runtime-24.js"));
  }
}
console.log(new C24().m()());
var c25 = typeof process.versions.bun === "string";
class C25 {
  m() {
    return () => (c25 ? 25 : require("./for-another-runtime-25.js"));
  }
}
console.log(new C25().m()());
var c26 = process.versions?.bun;
class C26 {
  m() {
    return () => (c26 ? 26 : require("./for-another-runtime-26.js"));
  }
}
console.log(new C26().m()());
var c27 = process?.versions?.bun;
class C27 {
  m() {
    return () => (c27 ? 27 : require("./for-another-runtime-27.js"));
  }
}
console.log(new C27().m()());
var c28 = globalThis.process?.versions?.bun;
class C28 {
  m() {
    return () => (c28 ? 28 : require("./for-another-runtime-28.js"));
  }
}
console.log(new C28().m()());
var c29 = "bun" in process.versions;
class C29 {
  m() {
    return () => (c29 ? 29 : require("./for-another-runtime-29.js"));
  }
}
console.log(new C29().m()());
var c30 = process.versions.node;
class C30 {
  m() {
    return () => (c30 ? 30 : require("./for-another-runtime-30.js"));
  }
}
console.log(new C30().m()());
var c31 = typeof process.versions.node === "string";
class C31 {
  m() {
    return () => (c31 ? 31 : require("./for-another-runtime-31.js"));
  }
}
console.log(new C31().m()());
var c32 = "node" in process.versions;
class C32 {
  m() {
    return () => (c32 ? 32 : require("./for-another-runtime-32.js"));
  }
}
console.log(new C32().m()());
var c33 = typeof process.release === "object";
class C33 {
  m() {
    return () => (c33 ? 33 : require("./for-another-runtime-33.js"));
  }
}
console.log(new C33().m()());
var c34 = process.release.name === "node";
class C34 {
  m() {
    return () => (c34 ? 34 : require("./for-another-runtime-34.js"));
  }
}
console.log(new C34().m()());
var c35 = process.release?.name !== "io.js";
class C35 {
  m() {
    return () => (c35 ? 35 : require("./for-another-runtime-35.js"));
  }
}
console.log(new C35().m()());
var c36 = typeof require === "function";
class C36 {
  m() {
    return () => (c36 ? 36 : require("./for-another-runtime-36.js"));
  }
}
console.log(new C36().m()());
var c37 = typeof module !== "undefined";
class C37 {
  m() {
    return () => (c37 ? 37 : require("./for-another-runtime-37.js"));
  }
}
console.log(new C37().m()());
var c38 =
  typeof process !== "undefined" &&
  typeof process.versions === "object" &&
  process.versions !== null &&
  typeof process.versions.bun === "string";
class C38 {
  m() {
    return () => (c38 ? 38 : require("./for-another-runtime-38.js"));
  }
}
console.log(new C38().m()());
var c39 = typeof process !== "undefined" && "bun" in process.versions;
class C39 {
  m() {
    return () => (c39 ? 39 : require("./for-another-runtime-39.js"));
  }
}
console.log(new C39().m()());
var c40 = typeof process !== "undefined" && process.versions != null && process.versions.node != null;
class C40 {
  m() {
    return () => (c40 ? 40 : require("./for-another-runtime-40.js"));
  }
}
console.log(new C40().m()());
var c41 = typeof Bun === "undefined" ? false : true;
class C41 {
  m() {
    return () => (c41 ? 41 : require("./for-another-runtime-41.js"));
  }
}
console.log(new C41().m()());
var c42 = typeof Bun === "undefined" || !("Bun" in globalThis) ? 0 : 1;
class C42 {
  m() {
    return () => (c42 ? 42 : require("./for-another-runtime-42.js"));
  }
}
console.log(new C42().m()());
var c43 = typeof Bun === "undefined" || typeof process === "undefined" ? 0 : 1;
class C43 {
  m() {
    return () => (c43 ? 43 : require("./for-another-runtime-43.js"));
  }
}
console.log(new C43().m()());
