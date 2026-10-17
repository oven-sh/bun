// A class with a computed member key, and `#name in object` tests in every other position of the class body.
function said(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
const name = () => "k";
const o = JSON.parse("{}");
class Top {
  static #f = 1; static #m() { return 2; } static get #g() { return 3; }
  [name()]() { return "dynamic"; }
  static a0(x) { return x.#f; }
  static a1(x) { return x.#m(); }
  static a2(x) { return x.#g; }
  static a3(x) { return #f in x; }
  static a4(x) { return (x.#f = 4); }
  static a5(x) { return x.#f; }
  static a6(x) { return x.#m(); }
  static a7(x) { return x.#g; }
  static a8(x) { return #f in x; }
  static a9(x) { return (x.#f = 9); }
  static a10(x) { return x.#f; }
  static a11(x) { return x.#m(); }
  static a12(x) { return x.#g; }
  static a13(x) { return #f in x; }
  static a14(x) { return (x.#f = 14); }
  static a15(x) { return x.#f; }
  static a16(x) { return x.#m(); }
  static a17(x) { return x.#g; }
  static a18(x) { return #f in x; }
  static a19(x) { return (x.#f = 19); }
  static a20(x) { return x.#f; }
  static a21(x) { return x.#m(); }
  static a22(x) { return x.#g; }
  static a23(x) { return #f in x; }
  static a24(x) { return (x.#f = 24); }
  static a25(x) { return x.#f; }
  static a26(x) { return x.#m(); }
  static a27(x) { return x.#g; }
  static a28(x) { return #f in x; }
  static a29(x) { return (x.#f = 29); }
  static a30(x) { return x.#f; }
  static a31(x) { return x.#m(); }
  static a32(x) { return x.#g; }
  static a33(x) { return #f in x; }
  static a34(x) { return (x.#f = 34); }
  static a35(x) { return x.#f; }
  static a36(x) { return x.#m(); }
  static a37(x) { return x.#g; }
  static a38(x) { return #f in x; }
  static a39(x) { return (x.#f = 39); }
}
function make(n) { return class Made {
  static #f = n; static #m() { return n; }
  [name() + n]() { return "dynamic"; }
  static a0(x) { return x.#f; }
  static a1(x) { return x.#m(); }
  static a2(x) { return #m in x; }
  static a3(x) { return (x.#f = 3); }
  static a4(x) { return x.#f; }
  static a5(x) { return x.#m(); }
  static a6(x) { return #m in x; }
  static a7(x) { return (x.#f = 7); }
  static a8(x) { return x.#f; }
  static a9(x) { return x.#m(); }
  static a10(x) { return #m in x; }
  static a11(x) { return (x.#f = 11); }
  static a12(x) { return x.#f; }
  static a13(x) { return x.#m(); }
  static a14(x) { return #m in x; }
  static a15(x) { return (x.#f = 15); }
  static a16(x) { return x.#f; }
  static a17(x) { return x.#m(); }
  static a18(x) { return #m in x; }
  static a19(x) { return (x.#f = 19); }
  static a20(x) { return x.#f; }
  static a21(x) { return x.#m(); }
  static a22(x) { return #m in x; }
  static a23(x) { return (x.#f = 23); }
  static a24(x) { return x.#f; }
  static a25(x) { return x.#m(); }
  static a26(x) { return #m in x; }
  static a27(x) { return (x.#f = 27); }
  static a28(x) { return x.#f; }
  static a29(x) { return x.#m(); }
  static a30(x) { return #m in x; }
  static a31(x) { return (x.#f = 31); }
  static a32(x) { return x.#f; }
  static a33(x) { return x.#m(); }
  static a34(x) { return #m in x; }
  static a35(x) { return (x.#f = 35); }
  static a36(x) { return x.#f; }
  static a37(x) { return x.#m(); }
  static a38(x) { return #m in x; }
  static a39(x) { return (x.#f = 39); }
}; }
const M = make(5); let right = 0, threw = 0;
for (let i = 0; i < 40; i++) { if (!said(() => Top["a" + i](Top)).startsWith("threw")) right++; if (!said(() => M["a" + i](M)).startsWith("threw")) right++; if (said(() => Top["a" + i](o)) === "threw TypeError") threw++; if (said(() => M["a" + i](o)) === "threw TypeError") threw++; }
console.log("found: " + right); console.log("threw: " + threw); console.log(new Top().k() + " " + new M().k5());
