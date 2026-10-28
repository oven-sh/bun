// Object literals whose getters and setters read a variable with a union type, and between the two halves of an accessor stands a member that stores a value of the other kind to it.
// Each half finds what the variable holds when the half is called. Each literal is made two dozen times.
const cases: [string, (seen: unknown[]) => (v: number) => object][] = [];
function id<T>(x: T): T { return x; }
const text = (x: unknown): string => (typeof x === "bigint" ? x + "n" : typeof x === "object" ? JSON.stringify(x) : String(x));
function show(o: any, seen: unknown[]): string {
  const out: string[] = [];
  for (const k of Reflect.ownKeys(o)) {
    const found = Object.getOwnPropertyDescriptor(o, k)!;
    if ("value" in found) { out.push(String(k) + "=" + text(found.value)); continue; }
    const got = found.get ? text(o[k]) : "-";
    let put = "-";
    if (found.set) { seen.length = 0; o[k] = "x"; put = seen.map(text).join("/"); }
    out.push(String(k) + ":" + got + "|" + put);
  }
  return out.join(" ");
}
cases.push(["1 S0 B G0 | q{k}: | let c: number | string = 'none'; | -", seen => {
  function make(v: number) {
    let c: number | string = "none";
    return { set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); }, q1: (c = (v + 1)), get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); } };
  }
  return make;
}]);
cases.push(["2 S0 B G0 | q{k}: | let c: number | undefined; | c = c;", seen => {
  function make(v: number) {
    let c: number | undefined;
    const o = { set p(x: unknown) { seen.push((() => c)(), x); }, q1: (c = (v + 1)), get p() { return (() => c)(); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["3 S0 B G0 | q{k}: | let c: number = 0; | late();", seen => {
  function make(v: number) {
    let c: number = 0;
    const late = () => { c = c; };
    const o = { set p(x: unknown) { seen.push(c, x); }, q1: (c = (v + 1) + 0.5), get p() { return c; } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["4 S0 B G0 | q{k}: | let c: { n: number } | null = null; | -", seen => {
  function make(v: number) {
    let c: { n: number } | null = null;
    return { set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); }, q1: ((c = { n: (v + 1) }), 1), get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); } };
  }
  return make;
}]);
cases.push(["5 S0 B G0 | q{k}: | let c: number[] | string = ''; | c = c;", seen => {
  function make(v: number) {
    let c: number[] | string = "";
    const o = { set p(x: unknown) { seen.push((() => c)(), x); }, q1: ((c = [(v + 1)]), 1), get p() { return (() => c)(); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["6 S0 B G0 | q{k}: | let c: bigint | number = 0; | late();", seen => {
  function make(v: number) {
    let c: bigint | number = 0;
    const late = () => { c = c; };
    const o = { set p(x: unknown) { seen.push(c, x); }, q1: ((c = BigInt((v + 1))), 1), get p() { return c; } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["7 S0 B G0 | q{k}: v & 1 ? | let c: boolean | number = false; | -", seen => {
  function make(v: number) {
    let c: boolean | number = false;
    return { set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); }, q1: v & 1 ? (c = (v + 1)) : 0, get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); } };
  }
  return make;
}]);
cases.push(["8 S0 B G0 | q{k}: v & 1 ? | let c: number | string = 0; | c = c;", seen => {
  function make(v: number) {
    let c: number | string = 0;
    const o = { set p(x: unknown) { seen.push((() => c)(), x); }, q1: v & 1 ? (c = "t" + (v + 1)) : 0, get p() { return (() => c)(); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["9 S0 B G0 | q{k}: v & 1 ? | let c: number | string = 'none'; | late();", seen => {
  function make(v: number) {
    let c: number | string = "none";
    const late = () => { c = c; };
    const o = { set p(x: unknown) { seen.push(c, x); }, q1: v & 1 ? (c = (v + 1)) : 0, get p() { return c; } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["10 S0 B G0 | q{k}: [ | let c: number | undefined; | -", seen => {
  function make(v: number) {
    let c: number | undefined;
    return { set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); }, q1: [(c = (v + 1))], get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); } };
  }
  return make;
}]);
cases.push(["11 S0 B G0 | q{k}: [ | let c: number = 0; | c = c;", seen => {
  function make(v: number) {
    let c: number = 0;
    const o = { set p(x: unknown) { seen.push((() => c)(), x); }, q1: [(c = (v + 1) + 0.5)], get p() { return (() => c)(); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["12 S0 B G0 | q{k}: [ | let c: { n: number } | null = null; | late();", seen => {
  function make(v: number) {
    let c: { n: number } | null = null;
    const late = () => { c = c; };
    const o = { set p(x: unknown) { seen.push(c, x); }, q1: [(c = { n: (v + 1) })], get p() { return c; } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["13 S0 B G0 | q{k}: id | let c: number[] | string = ''; | -", seen => {
  function make(v: number) {
    let c: number[] | string = "";
    return { set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); }, q1: id((c = [(v + 1)])), get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); } };
  }
  return make;
}]);
cases.push(["14 S0 B G0 | q{k}: id | let c: bigint | number = 0; | c = c;", seen => {
  function make(v: number) {
    let c: bigint | number = 0;
    const o = { set p(x: unknown) { seen.push((() => c)(), x); }, q1: id((c = BigInt((v + 1)))), get p() { return (() => c)(); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["15 S0 B G0 | q{k}: id | let c: boolean | number = false; | late();", seen => {
  function make(v: number) {
    let c: boolean | number = false;
    const late = () => { c = c; };
    const o = { set p(x: unknown) { seen.push(c, x); }, q1: id((c = (v + 1))), get p() { return c; } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["16 S0 B G0 | q{k}: bump | let c: number | string = 0; | -", seen => {
  function make(v: number) {
    let c: number | string = 0;
    const bump = (n: number | string) => (c = n);
    return { set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); }, q1: bump("t" + (v + 1)), get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); } };
  }
  return make;
}]);
cases.push(["17 S0 B G0 | q{k}: bump | let c: number | string = 'none'; | c = c;", seen => {
  function make(v: number) {
    let c: number | string = "none";
    const bump = (n: number | string) => (c = n);
    const o = { set p(x: unknown) { seen.push((() => c)(), x); }, q1: bump((v + 1)), get p() { return (() => c)(); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["18 S0 B G0 | q{k}: bump | let c: number | undefined; | late();", seen => {
  function make(v: number) {
    let c: number | undefined;
    const bump = (n: number | undefined) => (c = n);
    const late = () => { c = c; };
    const o = { set p(x: unknown) { seen.push(c, x); }, q1: bump((v + 1)), get p() { return c; } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["19 S0 B G0 | ... | let c: number = 0; | -", seen => {
  function make(v: number) {
    let c: number = 0;
    return { set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); }, ...((c = (v + 1) + 0.5), { z1: 1 }), get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); } };
  }
  return make;
}]);
cases.push(["20 S0 B G0 | ... | let c: { n: number } | null = null; | c = c;", seen => {
  function make(v: number) {
    let c: { n: number } | null = null;
    const o = { set p(x: unknown) { seen.push((() => c)(), x); }, ...((c = { n: (v + 1) }), { z1: 1 }), get p() { return (() => c)(); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["21 S0 B G0 | ... | let c: number[] | string = ''; | late();", seen => {
  function make(v: number) {
    let c: number[] | string = "";
    const late = () => { c = c; };
    const o = { set p(x: unknown) { seen.push(c, x); }, ...((c = [(v + 1)]), { z1: 1 }), get p() { return c; } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["22 S0 B G0 | [ | let c: bigint | number = 0; | -", seen => {
  function make(v: number) {
    let c: bigint | number = 0;
    return { set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); }, [((c = BigInt((v + 1))), "k1")]: 1, get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); } };
  }
  return make;
}]);
cases.push(["23 S0 B G0 | [ | let c: boolean | number = false; | c = c;", seen => {
  function make(v: number) {
    let c: boolean | number = false;
    const o = { set p(x: unknown) { seen.push((() => c)(), x); }, [((c = (v + 1)), "k1")]: 1, get p() { return (() => c)(); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["24 S0 B G0 | [ | let c: number | string = 0; | late();", seen => {
  function make(v: number) {
    let c: number | string = 0;
    const late = () => { c = c; };
    const o = { set p(x: unknown) { seen.push(c, x); }, [((c = "t" + (v + 1)), "k1")]: 1, get p() { return c; } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["25 G0 B S0 | q{k}: | let c: number | string = 'none'; | -", seen => {
  function make(v: number) {
    let c: number | string = "none";
    return { get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); }, q1: (c = (v + 1)), set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); } };
  }
  return make;
}]);
cases.push(["26 G0 B S0 | q{k}: | let c: number | undefined; | c = c;", seen => {
  function make(v: number) {
    let c: number | undefined;
    const o = { get p() { return (() => c)(); }, q1: (c = (v + 1)), set p(x: unknown) { seen.push((() => c)(), x); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["27 G0 B S0 | q{k}: | let c: number = 0; | late();", seen => {
  function make(v: number) {
    let c: number = 0;
    const late = () => { c = c; };
    const o = { get p() { return c; }, q1: (c = (v + 1) + 0.5), set p(x: unknown) { seen.push(c, x); } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["28 G0 B S0 | q{k}: | let c: { n: number } | null = null; | -", seen => {
  function make(v: number) {
    let c: { n: number } | null = null;
    return { get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); }, q1: ((c = { n: (v + 1) }), 1), set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); } };
  }
  return make;
}]);
cases.push(["29 G0 B S0 | q{k}: | let c: number[] | string = ''; | c = c;", seen => {
  function make(v: number) {
    let c: number[] | string = "";
    const o = { get p() { return (() => c)(); }, q1: ((c = [(v + 1)]), 1), set p(x: unknown) { seen.push((() => c)(), x); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["30 G0 B S0 | q{k}: | let c: bigint | number = 0; | late();", seen => {
  function make(v: number) {
    let c: bigint | number = 0;
    const late = () => { c = c; };
    const o = { get p() { return c; }, q1: ((c = BigInt((v + 1))), 1), set p(x: unknown) { seen.push(c, x); } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["31 G0 B S0 | q{k}: v & 1 ? | let c: boolean | number = false; | -", seen => {
  function make(v: number) {
    let c: boolean | number = false;
    return { get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); }, q1: v & 1 ? (c = (v + 1)) : 0, set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); } };
  }
  return make;
}]);
cases.push(["32 G0 B S0 | q{k}: v & 1 ? | let c: number | string = 0; | c = c;", seen => {
  function make(v: number) {
    let c: number | string = 0;
    const o = { get p() { return (() => c)(); }, q1: v & 1 ? (c = "t" + (v + 1)) : 0, set p(x: unknown) { seen.push((() => c)(), x); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["33 G0 B S0 | q{k}: v & 1 ? | let c: number | string = 'none'; | late();", seen => {
  function make(v: number) {
    let c: number | string = "none";
    const late = () => { c = c; };
    const o = { get p() { return c; }, q1: v & 1 ? (c = (v + 1)) : 0, set p(x: unknown) { seen.push(c, x); } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["34 G0 B S0 | q{k}: [ | let c: number | undefined; | -", seen => {
  function make(v: number) {
    let c: number | undefined;
    return { get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); }, q1: [(c = (v + 1))], set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); } };
  }
  return make;
}]);
cases.push(["35 G0 B S0 | q{k}: [ | let c: number = 0; | c = c;", seen => {
  function make(v: number) {
    let c: number = 0;
    const o = { get p() { return (() => c)(); }, q1: [(c = (v + 1) + 0.5)], set p(x: unknown) { seen.push((() => c)(), x); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["36 G0 B S0 | q{k}: [ | let c: { n: number } | null = null; | late();", seen => {
  function make(v: number) {
    let c: { n: number } | null = null;
    const late = () => { c = c; };
    const o = { get p() { return c; }, q1: [(c = { n: (v + 1) })], set p(x: unknown) { seen.push(c, x); } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["37 G0 B S0 | q{k}: id | let c: number[] | string = ''; | -", seen => {
  function make(v: number) {
    let c: number[] | string = "";
    return { get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); }, q1: id((c = [(v + 1)])), set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); } };
  }
  return make;
}]);
cases.push(["38 G0 B S0 | q{k}: id | let c: bigint | number = 0; | c = c;", seen => {
  function make(v: number) {
    let c: bigint | number = 0;
    const o = { get p() { return (() => c)(); }, q1: id((c = BigInt((v + 1)))), set p(x: unknown) { seen.push((() => c)(), x); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["39 G0 B S0 | q{k}: id | let c: boolean | number = false; | late();", seen => {
  function make(v: number) {
    let c: boolean | number = false;
    const late = () => { c = c; };
    const o = { get p() { return c; }, q1: id((c = (v + 1))), set p(x: unknown) { seen.push(c, x); } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["40 G0 B S0 | q{k}: bump | let c: number | string = 0; | -", seen => {
  function make(v: number) {
    let c: number | string = 0;
    const bump = (n: number | string) => (c = n);
    return { get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); }, q1: bump("t" + (v + 1)), set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); } };
  }
  return make;
}]);
cases.push(["41 G0 B S0 | q{k}: bump | let c: number | string = 'none'; | c = c;", seen => {
  function make(v: number) {
    let c: number | string = "none";
    const bump = (n: number | string) => (c = n);
    const o = { get p() { return (() => c)(); }, q1: bump((v + 1)), set p(x: unknown) { seen.push((() => c)(), x); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["42 G0 B S0 | q{k}: bump | let c: number | undefined; | late();", seen => {
  function make(v: number) {
    let c: number | undefined;
    const bump = (n: number | undefined) => (c = n);
    const late = () => { c = c; };
    const o = { get p() { return c; }, q1: bump((v + 1)), set p(x: unknown) { seen.push(c, x); } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["43 G0 B S0 | ... | let c: number = 0; | -", seen => {
  function make(v: number) {
    let c: number = 0;
    return { get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); }, ...((c = (v + 1) + 0.5), { z1: 1 }), set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); } };
  }
  return make;
}]);
cases.push(["44 G0 B S0 | ... | let c: { n: number } | null = null; | c = c;", seen => {
  function make(v: number) {
    let c: { n: number } | null = null;
    const o = { get p() { return (() => c)(); }, ...((c = { n: (v + 1) }), { z1: 1 }), set p(x: unknown) { seen.push((() => c)(), x); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["45 G0 B S0 | ... | let c: number[] | string = ''; | late();", seen => {
  function make(v: number) {
    let c: number[] | string = "";
    const late = () => { c = c; };
    const o = { get p() { return c; }, ...((c = [(v + 1)]), { z1: 1 }), set p(x: unknown) { seen.push(c, x); } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["46 G0 B S0 | [ | let c: bigint | number = 0; | -", seen => {
  function make(v: number) {
    let c: bigint | number = 0;
    return { get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); }, [((c = BigInt((v + 1))), "k1")]: 1, set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); } };
  }
  return make;
}]);
cases.push(["47 G0 B S0 | [ | let c: boolean | number = false; | c = c;", seen => {
  function make(v: number) {
    let c: boolean | number = false;
    const o = { get p() { return (() => c)(); }, [((c = (v + 1)), "k1")]: 1, set p(x: unknown) { seen.push((() => c)(), x); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["48 G0 B S0 | [ | let c: number | string = 0; | late();", seen => {
  function make(v: number) {
    let c: number | string = 0;
    const late = () => { c = c; };
    const o = { get p() { return c; }, [((c = "t" + (v + 1)), "k1")]: 1, set p(x: unknown) { seen.push(c, x); } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["49 B S0 B G0 | q{k}: | let c: number | string = 'none'; | -", seen => {
  function make(v: number) {
    let c: number | string = "none";
    return { q1: (c = (v + 1)), set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); }, q2: (c = (v + 2)), get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); } };
  }
  return make;
}]);
cases.push(["50 B S0 B G0 | q{k}: | let c: number | undefined; | c = c;", seen => {
  function make(v: number) {
    let c: number | undefined;
    const o = { q1: (c = (v + 1)), set p(x: unknown) { seen.push((() => c)(), x); }, q2: (c = (v + 2)), get p() { return (() => c)(); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["51 B S0 B G0 | q{k}: | let c: number = 0; | late();", seen => {
  function make(v: number) {
    let c: number = 0;
    const late = () => { c = c; };
    const o = { q1: (c = (v + 1) + 0.5), set p(x: unknown) { seen.push(c, x); }, q2: (c = (v + 2) + 0.5), get p() { return c; } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["52 B S0 B G0 | q{k}: | let c: { n: number } | null = null; | -", seen => {
  function make(v: number) {
    let c: { n: number } | null = null;
    return { q1: ((c = { n: (v + 1) }), 1), set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); }, q2: ((c = { n: (v + 2) }), 2), get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); } };
  }
  return make;
}]);
cases.push(["53 B S0 B G0 | q{k}: | let c: number[] | string = ''; | c = c;", seen => {
  function make(v: number) {
    let c: number[] | string = "";
    const o = { q1: ((c = [(v + 1)]), 1), set p(x: unknown) { seen.push((() => c)(), x); }, q2: ((c = [(v + 2)]), 2), get p() { return (() => c)(); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["54 B S0 B G0 | q{k}: | let c: bigint | number = 0; | late();", seen => {
  function make(v: number) {
    let c: bigint | number = 0;
    const late = () => { c = c; };
    const o = { q1: ((c = BigInt((v + 1))), 1), set p(x: unknown) { seen.push(c, x); }, q2: ((c = BigInt((v + 2))), 2), get p() { return c; } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["55 B S0 B G0 | q{k}: v & 1 ? | let c: boolean | number = false; | -", seen => {
  function make(v: number) {
    let c: boolean | number = false;
    return { q1: v & 1 ? (c = (v + 1)) : 0, set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); }, q2: v & 1 ? (c = (v + 2)) : 0, get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); } };
  }
  return make;
}]);
cases.push(["56 B S0 B G0 | q{k}: v & 1 ? | let c: number | string = 0; | c = c;", seen => {
  function make(v: number) {
    let c: number | string = 0;
    const o = { q1: v & 1 ? (c = "t" + (v + 1)) : 0, set p(x: unknown) { seen.push((() => c)(), x); }, q2: v & 1 ? (c = "t" + (v + 2)) : 0, get p() { return (() => c)(); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["57 B S0 B G0 | q{k}: v & 1 ? | let c: number | string = 'none'; | late();", seen => {
  function make(v: number) {
    let c: number | string = "none";
    const late = () => { c = c; };
    const o = { q1: v & 1 ? (c = (v + 1)) : 0, set p(x: unknown) { seen.push(c, x); }, q2: v & 1 ? (c = (v + 2)) : 0, get p() { return c; } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["58 B S0 B G0 | q{k}: [ | let c: number | undefined; | -", seen => {
  function make(v: number) {
    let c: number | undefined;
    return { q1: [(c = (v + 1))], set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); }, q2: [(c = (v + 2))], get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); } };
  }
  return make;
}]);
cases.push(["59 B S0 B G0 | q{k}: [ | let c: number = 0; | c = c;", seen => {
  function make(v: number) {
    let c: number = 0;
    const o = { q1: [(c = (v + 1) + 0.5)], set p(x: unknown) { seen.push((() => c)(), x); }, q2: [(c = (v + 2) + 0.5)], get p() { return (() => c)(); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["60 B S0 B G0 | q{k}: [ | let c: { n: number } | null = null; | late();", seen => {
  function make(v: number) {
    let c: { n: number } | null = null;
    const late = () => { c = c; };
    const o = { q1: [(c = { n: (v + 1) })], set p(x: unknown) { seen.push(c, x); }, q2: [(c = { n: (v + 2) })], get p() { return c; } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["61 B S0 B G0 | q{k}: id | let c: number[] | string = ''; | -", seen => {
  function make(v: number) {
    let c: number[] | string = "";
    return { q1: id((c = [(v + 1)])), set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); }, q2: id((c = [(v + 2)])), get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); } };
  }
  return make;
}]);
cases.push(["62 B S0 B G0 | q{k}: id | let c: bigint | number = 0; | c = c;", seen => {
  function make(v: number) {
    let c: bigint | number = 0;
    const o = { q1: id((c = BigInt((v + 1)))), set p(x: unknown) { seen.push((() => c)(), x); }, q2: id((c = BigInt((v + 2)))), get p() { return (() => c)(); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["63 B S0 B G0 | q{k}: id | let c: boolean | number = false; | late();", seen => {
  function make(v: number) {
    let c: boolean | number = false;
    const late = () => { c = c; };
    const o = { q1: id((c = (v + 1))), set p(x: unknown) { seen.push(c, x); }, q2: id((c = (v + 2))), get p() { return c; } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["64 B S0 B G0 | q{k}: bump | let c: number | string = 0; | -", seen => {
  function make(v: number) {
    let c: number | string = 0;
    const bump = (n: number | string) => (c = n);
    return { q1: bump("t" + (v + 1)), set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); }, q2: bump("t" + (v + 2)), get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); } };
  }
  return make;
}]);
cases.push(["65 B S0 B G0 | q{k}: bump | let c: number | string = 'none'; | c = c;", seen => {
  function make(v: number) {
    let c: number | string = "none";
    const bump = (n: number | string) => (c = n);
    const o = { q1: bump((v + 1)), set p(x: unknown) { seen.push((() => c)(), x); }, q2: bump((v + 2)), get p() { return (() => c)(); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["66 B S0 B G0 | q{k}: bump | let c: number | undefined; | late();", seen => {
  function make(v: number) {
    let c: number | undefined;
    const bump = (n: number | undefined) => (c = n);
    const late = () => { c = c; };
    const o = { q1: bump((v + 1)), set p(x: unknown) { seen.push(c, x); }, q2: bump((v + 2)), get p() { return c; } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["67 B S0 B G0 | ... | let c: number = 0; | -", seen => {
  function make(v: number) {
    let c: number = 0;
    return { ...((c = (v + 1) + 0.5), { z1: 1 }), set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); }, ...((c = (v + 2) + 0.5), { z2: 1 }), get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); } };
  }
  return make;
}]);
cases.push(["68 B S0 B G0 | ... | let c: { n: number } | null = null; | c = c;", seen => {
  function make(v: number) {
    let c: { n: number } | null = null;
    const o = { ...((c = { n: (v + 1) }), { z1: 1 }), set p(x: unknown) { seen.push((() => c)(), x); }, ...((c = { n: (v + 2) }), { z2: 1 }), get p() { return (() => c)(); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["69 B S0 B G0 | ... | let c: number[] | string = ''; | late();", seen => {
  function make(v: number) {
    let c: number[] | string = "";
    const late = () => { c = c; };
    const o = { ...((c = [(v + 1)]), { z1: 1 }), set p(x: unknown) { seen.push(c, x); }, ...((c = [(v + 2)]), { z2: 1 }), get p() { return c; } };
    late();
    return o;
  }
  return make;
}]);
cases.push(["70 B S0 B G0 | [ | let c: bigint | number = 0; | -", seen => {
  function make(v: number) {
    let c: bigint | number = 0;
    return { [((c = BigInt((v + 1))), "k1")]: 1, set p(x: unknown) { seen.push(typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c), x); }, [((c = BigInt((v + 2))), "k2")]: 1, get p() { return typeof c + ":" + JSON.stringify(typeof c === "bigint" ? String(c) : c); } };
  }
  return make;
}]);
cases.push(["71 B S0 B G0 | [ | let c: boolean | number = false; | c = c;", seen => {
  function make(v: number) {
    let c: boolean | number = false;
    const o = { [((c = (v + 1)), "k1")]: 1, set p(x: unknown) { seen.push((() => c)(), x); }, [((c = (v + 2)), "k2")]: 1, get p() { return (() => c)(); } };
    c = c;
    return o;
  }
  return make;
}]);
cases.push(["72 B S0 B G0 | [ | let c: number | string = 0; | late();", seen => {
  function make(v: number) {
    let c: number | string = 0;
    const late = () => { c = c; };
    const o = { [((c = "t" + (v + 1)), "k1")]: 1, set p(x: unknown) { seen.push(c, x); }, [((c = "t" + (v + 2)), "k2")]: 1, get p() { return c; } };
    late();
    return o;
  }
  return make;
}]);

for (const [label, prepare] of cases) {
  const seen: unknown[] = [];
  const said: string[] = [];
  try {
    const make = prepare(seen);
    for (let turn = 0; turn < 24; turn++) {
      const line = show(make(5 + turn), seen);
      if (turn < 2 || turn === 23) said.push(line);
    }
  } catch (error) {
    said.push("THROWS " + (error as Error).constructor.name);
  }
  console.log(label + " => " + said.join(" ;; "));
}
