// Switches over constants of a module that hold one symbol each: the case is told by the place of the symbol's cell, if it lies there.
const Z = Symbol("z");
const A0 = Symbol("a0");
const A1 = Symbol("a1");
const A2 = Symbol("a2");
const A3 = Symbol();
const A4 = Symbol("a0");
const A5 = Symbol("a5");
const A6 = Symbol("a6");
const A7 = Symbol("a7");
const A8 = Symbol("a8");
const A9 = Symbol("a9");
const B0 = Symbol("b0");
const B1 = Symbol("b1");
const B2 = Symbol("b2");
const B3 = Symbol("b3");
const B4 = Symbol("b4");
const B5 = Symbol("b5");
const B6 = Symbol("b6");
const B7 = Symbol("b7");
const B8 = Symbol("b8");
const B9 = Symbol("b9");
const C9 = Symbol("c9");
const C8 = Symbol("c8");
const C7 = Symbol("c7");
const C6 = Symbol("c6");
const C5 = Symbol("c5");
const C4 = Symbol("c4");
const C3 = Symbol("c3");
const C2 = Symbol("c2");
const C1 = Symbol("c1");
const C0 = Symbol("c0");
class Inst { constructor(op) { this._op = op; } get op() { return this._op; } }
function side(x) {
    switch (x) {
    case A0: return "A0";
    case A1: return "A1";
    case A2:
    case A3: return "A2 or A3";
    case A4: { let s = ""; for (let i = 0; i < 3; i++) s += i; return s; }
    case A5: return A5 === x ? "A5" : "wrong";
    case A6: return A6.description + A7.description;
    case A7: break;
    case A8: throw new Error("A8");
    case A9: return "A9";
    default: return "none of A";
    }
    return "A7";
}
function apartFrom(x, y) {
    let n = y;
    switch (x) {
    case B0: n += 1;
    case B1: n += 2; break;
    case B2: n += 3; break;
    case B3: n += 4; break;
    case B4: n += 5; break;
    case B5: n += 6; break;
    case B6: n += 7; break;
    case B7: n += 8; break;
    case B8: n += 9; break;
    case B9: n += 10; break;
    default: n -= 1;
    }
    return n;
}
function backwards(x) {
    if (x === C0) return 0;
    if (x === C1) return 1;
    if (x === C2) return 2;
    if (x === C3) return 3;
    if (x === C4) return 4;
    if (x === C5) return 5;
    if (x === C6) return 6;
    if (x === C7) return 7;
    if (x === C8) return 8;
    if (x === C9) return 9;
    return -1;
}
function declaredOrder(x) {
    if (C9 === x) return 9;
    if (C8 === x) return 8;
    if (C7 === x) return 7;
    if (C6 === x) return 6;
    if (C5 === x) return 5;
    if (C4 === x) return 4;
    if (C3 === x) return 3;
    if (C2 === x) return 2;
    if (C1 === x) return 1;
    return x === C0 ? 0 : -1;
}
const apart = []; for (let i = 0; i < 50; i++) apart.push(Symbol("x" + i));
const made = [new Inst(A0), new Inst(A1), new Inst(A2), new Inst(A3), new Inst(A4), new Inst(A5), new Inst(A6), new Inst(A7), new Inst(A8), new Inst(A9), new Inst(B5), new Inst(C5), new Inst(Z)];
const all = { A0, A1, A2, A3, A4, A5, A6, A7, A8, A9, B0, B1, B2, B3, B4, B5, B6, B7, B8, B9, C0, C1, C2, C3, C4, C5, C6, C7, C8, C9 };
globalThis[["si", "de"].join("")] = side;
const given = [...Object.values(all), ...apart.slice(0, 40), ...apart.slice(-4), undefined, null, true, 0, 1, -1, NaN, 1.5, 2 ** 40, "a0", "", {}, [], () => 1, 3n, Symbol("a0"), Symbol.for("a0")];
const tried = (f, ...args) => { try { return String(f(...args)); } catch (e) { return e.constructor.name + ":" + e.message; } };
for (let turn = 0; turn < 3; turn++) {
    console.log(given.map(x => tried(globalThis.side, x)).join());
    console.log(given.map(x => tried(apartFrom, x, turn)).join());
    console.log(given.map(x => tried(backwards, x)).join());
    console.log(given.map(x => tried(declaredOrder, x)).join());
    console.log(made.map(inst => tried(globalThis.side, inst.op) + tried(backwards, inst.op)).join());
    let sum = 0;
    for (let i = 0; i < 3000; i++) { const x = given[(i * 7) % given.length]; sum = (sum * 31 + backwards(x) + apartFrom(x, i) + declaredOrder(x)) | 0; }
    console.log(sum);
    Bun.gc(true);
}
