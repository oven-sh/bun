// Flags: --minify
const first = (exports.first = []);
let count = 0;
const add = (name, value) => {
  count++;
  first.push(name);
  return value;
};
const a = (exports.member0 = add("a", 0));
const b = (exports.member1 = add("b", 1));
const c = (exports.member2 = add("c", 2));
const d = (exports.member3 = add("d", 3));
const e = (exports.member4 = add("e", 4));
const f = (exports.member5 = add("f", 5));
const g = (exports.member6 = add("g", 6));
const h = (exports.member7 = add("h", 7));
const i = (exports.member8 = add("i", 8));
const j = (exports.member9 = add("j", 9));
const k = (exports.member10 = add("k", 10));
const l = (exports.member11 = add("l", 11));
const m = (exports.member12 = add("m", 12));
const n = (exports.member13 = add("n", 13));
const o = (exports.member14 = add("o", 14));
const p = (exports.member15 = add("p", 15));
const q = (exports.member16 = add("q", 16));
const r = (exports.member17 = add("r", 17));
const s = (exports.member18 = add("s", 18));
const t = (exports.member19 = add("t", 19));
const u = (exports.member20 = add("u", 20));
const v = (exports.member21 = add("v", 21));
const w = (exports.member22 = add("w", 22));
const x = (exports.member23 = add("x", 23));
const y = (exports.member24 = add("y", 24));
const z = (exports.member25 = add("z", 25));
const A = (exports.member26 = add("A", 26));
const B = (exports.member27 = add("B", 27));
const C = (exports.member28 = add("C", 28));
const D = (exports.member29 = add("D", 29));
const E = (exports.member30 = add("E", 30));
const F = (exports.member31 = add("F", 31));
const G = (exports.member32 = add("G", 32));
const H = (exports.member33 = add("H", 33));
const I = (exports.member34 = add("I", 34));
const J = (exports.member35 = add("J", 35));
const K = (exports.member36 = add("K", 36));
const L = (exports.member37 = add("L", 37));
const M = (exports.member38 = add("M", 38));
const N = (exports.member39 = add("N", 39));
const O = (exports.member40 = add("O", 40));
const P = (exports.member41 = add("P", 41));
const Q = (exports.member42 = add("Q", 42));
const R = (exports.member43 = add("R", 43));
const S = (exports.member44 = add("S", 44));
const T = (exports.member45 = add("T", 45));
const U = (exports.member46 = add("U", 46));
const V = (exports.member47 = add("V", 47));
const W = (exports.member48 = add("W", 48));
const X = (exports.member49 = add("X", 49));
const Y = (exports.member50 = add("Y", 50));
const Z = (exports.member51 = add("Z", 51));
const $ = (exports.member52 = add("$", 52));
const _ = (exports.member53 = add("_", 53));
console.log(
  count,
  first.join(""),
  a +
    b +
    c +
    d +
    e +
    f +
    g +
    h +
    i +
    j +
    k +
    l +
    m +
    n +
    o +
    p +
    q +
    r +
    s +
    t +
    u +
    v +
    w +
    x +
    y +
    z +
    A +
    B +
    C +
    D +
    E +
    F +
    G +
    H +
    I +
    J +
    K +
    L +
    M +
    N +
    O +
    P +
    Q +
    R +
    S +
    T +
    U +
    V +
    W +
    X +
    Y +
    Z +
    $ +
    _,
);
