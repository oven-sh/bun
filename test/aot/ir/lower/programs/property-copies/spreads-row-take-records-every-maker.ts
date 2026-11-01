// RUN: lower
// OPTIONS: builtin-modules

// Spreads in a row take records whose every maker is in sight.
const log: string[] = [];
const mark = Symbol("mark");
function describe(o: object | null | undefined): string {
  if (o === null || o === undefined) return String(o);
  const parts: string[] = [];
  for (const k of Reflect.ownKeys(o)) {
    const d = Object.getOwnPropertyDescriptor(o, k)!;
    const v = "value" in d ? (typeof d.value === "function" ? "fn" : typeof d.value === "object" && d.value !== null ? describe(d.value) : Object.is(d.value, -0) ? "-0" : String(d.value)) : "accessor";
    parts.push(String(k) + ":" + v + (d.enumerable ? "e" : "-") + (d.writable ? "w" : "-") + (d.configurable ? "c" : "-"));
  }
  return "{" + parts.join(",") + "}" + (Object.getPrototypeOf(o) === Object.prototype || Array.isArray(o) ? "" : "!proto") + (Object.isExtensible(o) ? "" : "!ext");
}
function say(name: string, text: string): void { console.log(name + " = " + text + (log.length ? " | " + log.join(" ") : "")); log.length = 0; }

type W0 = { a: number; b: number; c: number };
function make0(): W0[] { const list: W0[] = [{ a: 1, b: 2, c: 3 }, { a: 4, b: 5, c: 6 }];  return list; }
function chain0(p: W0): W0 { p = { ...p, a: 10 }; p = { ...p, b: 20 }; p = { ...p, c: 30 }; p = { ...p, a: 10 }; return p; }
function copies0(p: W0): W0 { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function dropped0(p: W0): string { const q = { ...p, a: 10 }; const r = { ...q, b: 20 }; return String(r.a) + "," + typeof r.b + "," + String(r.c === null ? null : typeof r.c); }
function droppedCopy0(p: W0): string { const q = { ...p }; return String(q.a) + "," + typeof q.b + "," + typeof q.c + "," + Object.keys(q).join(); }
function kept0(p: W0): W0 { return { ...p, c: 30 }; }
function keptCopy0(p: W0): W0 { return { ...p }; }
function maybe0(p: W0 | undefined | null): W0 | { a: W0["a"] } { return { ...p, a: 10 }; }
function branch0(p: W0, f: boolean): W0 { let q: W0; if (f) q = { ...p, a: 10 }; else q = { ...p }; return { ...q, c: 30 }; }
function loop0(p: W0, n: number): string { let s = ""; for (let i = 0; i < n; i++) { const q = { ...p, a: 10 }; s += String(q.a) + typeof q.b + typeof q.c + ";"; } return s; }
function carried0(p: W0, n: number): W0 { for (let i = 0; i < n; i++) { p = { ...p, a: 10 }; p = { ...p }; } return p; }
function two0(p: W0, q: W0): W0 { return { ...p, ...q }; }
function alias0(p: W0): string { const q = { ...p, c: 30 }; q.a = 10; return describe(q) + " from " + describe(p); }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 2; i++) {
    const w = "plain " + i + " ";
    say(w + "chain", describe(chain0(make0()[i])));
    say(w + "copies", describe(copies0(make0()[i])));
    say(w + "dropped", dropped0(make0()[i]));
    say(w + "droppedCopy", droppedCopy0(make0()[i]));
    say(w + "kept", describe(kept0(make0()[i])));
    say(w + "keptCopy", describe(keptCopy0(make0()[i])));
    say(w + "maybe", describe(maybe0(make0()[i])) + describe(maybe0(round ? undefined : null)));
    say(w + "branch", describe(branch0(make0()[i], true)) + describe(branch0(make0()[i], false)));
    say(w + "loop", loop0(make0()[i], 3));
    say(w + "carried", describe(carried0(make0()[i], 0)) + describe(carried0(make0()[i], 3)));
    say(w + "two", describe(two0(make0()[i], make0()[0])) + describe(two0(make0()[0], make0()[i])));
    say(w + "alias", alias0(make0()[i]));
  }
}

type W1 = { a: number; b: number; c: number };
function make1(): W1[] { const list: W1[] = [{ a: 1, b: 2, c: 3 }, { c: 6, a: 4, b: 5 }, { b: 8, c: 9, a: 7 }];  return list; }
function chain1(p: W1): W1 { p = { ...p, a: 10 }; p = { ...p, b: 20 }; p = { ...p, c: 30 }; p = { ...p, a: 10 }; return p; }
function copies1(p: W1): W1 { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function dropped1(p: W1): string { const q = { ...p, a: 10 }; const r = { ...q, b: 20 }; return String(r.a) + "," + typeof r.b + "," + String(r.c === null ? null : typeof r.c); }
function droppedCopy1(p: W1): string { const q = { ...p }; return String(q.a) + "," + typeof q.b + "," + typeof q.c + "," + Object.keys(q).join(); }
function kept1(p: W1): W1 { return { ...p, c: 30 }; }
function keptCopy1(p: W1): W1 { return { ...p }; }
function maybe1(p: W1 | undefined | null): W1 | { a: W1["a"] } { return { ...p, a: 10 }; }
function branch1(p: W1, f: boolean): W1 { let q: W1; if (f) q = { ...p, a: 10 }; else q = { ...p }; return { ...q, c: 30 }; }
function loop1(p: W1, n: number): string { let s = ""; for (let i = 0; i < n; i++) { const q = { ...p, a: 10 }; s += String(q.a) + typeof q.b + typeof q.c + ";"; } return s; }
function carried1(p: W1, n: number): W1 { for (let i = 0; i < n; i++) { p = { ...p, a: 10 }; p = { ...p }; } return p; }
function two1(p: W1, q: W1): W1 { return { ...p, ...q }; }
function alias1(p: W1): string { const q = { ...p, c: 30 }; q.a = 10; return describe(q) + " from " + describe(p); }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 3; i++) {
    const w = "orders " + i + " ";
    say(w + "chain", describe(chain1(make1()[i])));
    say(w + "copies", describe(copies1(make1()[i])));
    say(w + "dropped", dropped1(make1()[i]));
    say(w + "droppedCopy", droppedCopy1(make1()[i]));
    say(w + "kept", describe(kept1(make1()[i])));
    say(w + "keptCopy", describe(keptCopy1(make1()[i])));
    say(w + "maybe", describe(maybe1(make1()[i])) + describe(maybe1(round ? undefined : null)));
    say(w + "branch", describe(branch1(make1()[i], true)) + describe(branch1(make1()[i], false)));
    say(w + "loop", loop1(make1()[i], 3));
    say(w + "carried", describe(carried1(make1()[i], 0)) + describe(carried1(make1()[i], 3)));
    say(w + "two", describe(two1(make1()[i], make1()[0])) + describe(two1(make1()[0], make1()[i])));
    say(w + "alias", alias1(make1()[i]));
  }
}

type W2 = { a: number; b?: number; c: number };
function make2(): W2[] { const list: W2[] = [{ a: 1, b: 2, c: 3 }, { a: 4, c: 6 }, { c: 9, a: 7 }];  return list; }
function chain2(p: W2): W2 { p = { ...p, a: 10 }; p = { ...p, b: 20 }; p = { ...p, c: 30 }; p = { ...p, a: 10 }; return p; }
function copies2(p: W2): W2 { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function dropped2(p: W2): string { const q = { ...p, a: 10 }; const r = { ...q, b: 20 }; return String(r.a) + "," + typeof r.b + "," + String(r.c === null ? null : typeof r.c); }
function droppedCopy2(p: W2): string { const q = { ...p }; return String(q.a) + "," + typeof q.b + "," + typeof q.c + "," + Object.keys(q).join(); }
function kept2(p: W2): W2 { return { ...p, c: 30 }; }
function keptCopy2(p: W2): W2 { return { ...p }; }
function maybe2(p: W2 | undefined | null): W2 | { a: W2["a"] } { return { ...p, a: 10 }; }
function branch2(p: W2, f: boolean): W2 { let q: W2; if (f) q = { ...p, a: 10 }; else q = { ...p }; return { ...q, c: 30 }; }
function loop2(p: W2, n: number): string { let s = ""; for (let i = 0; i < n; i++) { const q = { ...p, a: 10 }; s += String(q.a) + typeof q.b + typeof q.c + ";"; } return s; }
function carried2(p: W2, n: number): W2 { for (let i = 0; i < n; i++) { p = { ...p, a: 10 }; p = { ...p }; } return p; }
function two2(p: W2, q: W2): W2 { return { ...p, ...q }; }
function alias2(p: W2): string { const q = { ...p, c: 30 }; q.a = 10; return describe(q) + " from " + describe(p); }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 3; i++) {
    const w = "optional " + i + " ";
    say(w + "chain", describe(chain2(make2()[i])));
    say(w + "copies", describe(copies2(make2()[i])));
    say(w + "dropped", dropped2(make2()[i]));
    say(w + "droppedCopy", droppedCopy2(make2()[i]));
    say(w + "kept", describe(kept2(make2()[i])));
    say(w + "keptCopy", describe(keptCopy2(make2()[i])));
    say(w + "maybe", describe(maybe2(make2()[i])) + describe(maybe2(round ? undefined : null)));
    say(w + "branch", describe(branch2(make2()[i], true)) + describe(branch2(make2()[i], false)));
    say(w + "loop", loop2(make2()[i], 3));
    say(w + "carried", describe(carried2(make2()[i], 0)) + describe(carried2(make2()[i], 3)));
    say(w + "two", describe(two2(make2()[i], make2()[0])) + describe(two2(make2()[0], make2()[i])));
    say(w + "alias", alias2(make2()[i]));
  }
}

type W3 = { a: number; b?: number; c: number };
function make3(): W3[] { const list: W3[] = [{ a: 1, b: 2, c: 3 }, { a: 4, b: 5, c: 6 }]; delete list[1].b; return list; }
function chain3(p: W3): W3 { p = { ...p, a: 10 }; p = { ...p, b: 20 }; p = { ...p, c: 30 }; p = { ...p, a: 10 }; return p; }
function copies3(p: W3): W3 { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function dropped3(p: W3): string { const q = { ...p, a: 10 }; const r = { ...q, b: 20 }; return String(r.a) + "," + typeof r.b + "," + String(r.c === null ? null : typeof r.c); }
function droppedCopy3(p: W3): string { const q = { ...p }; return String(q.a) + "," + typeof q.b + "," + typeof q.c + "," + Object.keys(q).join(); }
function kept3(p: W3): W3 { return { ...p, c: 30 }; }
function keptCopy3(p: W3): W3 { return { ...p }; }
function maybe3(p: W3 | undefined | null): W3 | { a: W3["a"] } { return { ...p, a: 10 }; }
function branch3(p: W3, f: boolean): W3 { let q: W3; if (f) q = { ...p, a: 10 }; else q = { ...p }; return { ...q, c: 30 }; }
function loop3(p: W3, n: number): string { let s = ""; for (let i = 0; i < n; i++) { const q = { ...p, a: 10 }; s += String(q.a) + typeof q.b + typeof q.c + ";"; } return s; }
function carried3(p: W3, n: number): W3 { for (let i = 0; i < n; i++) { p = { ...p, a: 10 }; p = { ...p }; } return p; }
function two3(p: W3, q: W3): W3 { return { ...p, ...q }; }
function alias3(p: W3): string { const q = { ...p, c: 30 }; q.a = 10; return describe(q) + " from " + describe(p); }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 2; i++) {
    const w = "deleted " + i + " ";
    say(w + "chain", describe(chain3(make3()[i])));
    say(w + "copies", describe(copies3(make3()[i])));
    say(w + "dropped", dropped3(make3()[i]));
    say(w + "droppedCopy", droppedCopy3(make3()[i]));
    say(w + "kept", describe(kept3(make3()[i])));
    say(w + "keptCopy", describe(keptCopy3(make3()[i])));
    say(w + "maybe", describe(maybe3(make3()[i])) + describe(maybe3(round ? undefined : null)));
    say(w + "branch", describe(branch3(make3()[i], true)) + describe(branch3(make3()[i], false)));
    say(w + "loop", loop3(make3()[i], 3));
    say(w + "carried", describe(carried3(make3()[i], 0)) + describe(carried3(make3()[i], 3)));
    say(w + "two", describe(two3(make3()[i], make3()[0])) + describe(two3(make3()[0], make3()[i])));
    say(w + "alias", alias3(make3()[i]));
  }
}

type W4 = { a?: number; b: number; c: number };
function make4(): W4[] { const list: W4[] = [{ a: 1, b: 2, c: 3 }, { a: 4, b: 5, c: 6 }]; delete list[1].a; list[1].a = 40; return list; }
function chain4(p: W4): W4 { p = { ...p, a: 10 }; p = { ...p, b: 20 }; p = { ...p, c: 30 }; p = { ...p, a: 10 }; return p; }
function copies4(p: W4): W4 { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function dropped4(p: W4): string { const q = { ...p, a: 10 }; const r = { ...q, b: 20 }; return String(r.a) + "," + typeof r.b + "," + String(r.c === null ? null : typeof r.c); }
function droppedCopy4(p: W4): string { const q = { ...p }; return String(q.a) + "," + typeof q.b + "," + typeof q.c + "," + Object.keys(q).join(); }
function kept4(p: W4): W4 { return { ...p, c: 30 }; }
function keptCopy4(p: W4): W4 { return { ...p }; }
function maybe4(p: W4 | undefined | null): W4 | { a: W4["a"] } { return { ...p, a: 10 }; }
function branch4(p: W4, f: boolean): W4 { let q: W4; if (f) q = { ...p, a: 10 }; else q = { ...p }; return { ...q, c: 30 }; }
function loop4(p: W4, n: number): string { let s = ""; for (let i = 0; i < n; i++) { const q = { ...p, a: 10 }; s += String(q.a) + typeof q.b + typeof q.c + ";"; } return s; }
function carried4(p: W4, n: number): W4 { for (let i = 0; i < n; i++) { p = { ...p, a: 10 }; p = { ...p }; } return p; }
function two4(p: W4, q: W4): W4 { return { ...p, ...q }; }
function alias4(p: W4): string { const q = { ...p, c: 30 }; q.a = 10; return describe(q) + " from " + describe(p); }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 2; i++) {
    const w = "deletedAndBack " + i + " ";
    say(w + "chain", describe(chain4(make4()[i])));
    say(w + "copies", describe(copies4(make4()[i])));
    say(w + "dropped", dropped4(make4()[i]));
    say(w + "droppedCopy", droppedCopy4(make4()[i]));
    say(w + "kept", describe(kept4(make4()[i])));
    say(w + "keptCopy", describe(keptCopy4(make4()[i])));
    say(w + "maybe", describe(maybe4(make4()[i])) + describe(maybe4(round ? undefined : null)));
    say(w + "branch", describe(branch4(make4()[i], true)) + describe(branch4(make4()[i], false)));
    say(w + "loop", loop4(make4()[i], 3));
    say(w + "carried", describe(carried4(make4()[i], 0)) + describe(carried4(make4()[i], 3)));
    say(w + "two", describe(two4(make4()[i], make4()[0])) + describe(two4(make4()[0], make4()[i])));
    say(w + "alias", alias4(make4()[i]));
  }
}

type W5 = { a: number; b: number; c: number };
function make5(): W5[] { const list: W5[] = [{ a: 1, b: 2, c: 3 }, { a: 4, b: 5, c: 6 }]; Object.defineProperty(list[1], 'b', { get() { log.push('get b'); return 55; }, enumerable: true, configurable: true }); return list; }
function chain5(p: W5): W5 { p = { ...p, a: 10 }; p = { ...p, b: 20 }; p = { ...p, c: 30 }; p = { ...p, a: 10 }; return p; }
function copies5(p: W5): W5 { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function dropped5(p: W5): string { const q = { ...p, a: 10 }; const r = { ...q, b: 20 }; return String(r.a) + "," + typeof r.b + "," + String(r.c === null ? null : typeof r.c); }
function droppedCopy5(p: W5): string { const q = { ...p }; return String(q.a) + "," + typeof q.b + "," + typeof q.c + "," + Object.keys(q).join(); }
function kept5(p: W5): W5 { return { ...p, c: 30 }; }
function keptCopy5(p: W5): W5 { return { ...p }; }
function maybe5(p: W5 | undefined | null): W5 | { a: W5["a"] } { return { ...p, a: 10 }; }
function branch5(p: W5, f: boolean): W5 { let q: W5; if (f) q = { ...p, a: 10 }; else q = { ...p }; return { ...q, c: 30 }; }
function loop5(p: W5, n: number): string { let s = ""; for (let i = 0; i < n; i++) { const q = { ...p, a: 10 }; s += String(q.a) + typeof q.b + typeof q.c + ";"; } return s; }
function carried5(p: W5, n: number): W5 { for (let i = 0; i < n; i++) { p = { ...p, a: 10 }; p = { ...p }; } return p; }
function two5(p: W5, q: W5): W5 { return { ...p, ...q }; }
function alias5(p: W5): string { const q = { ...p, c: 30 }; q.a = 10; return describe(q) + " from " + describe(p); }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 2; i++) {
    const w = "getter " + i + " ";
    say(w + "chain", describe(chain5(make5()[i])));
    say(w + "copies", describe(copies5(make5()[i])));
    say(w + "dropped", dropped5(make5()[i]));
    say(w + "droppedCopy", droppedCopy5(make5()[i]));
    say(w + "kept", describe(kept5(make5()[i])));
    say(w + "keptCopy", describe(keptCopy5(make5()[i])));
    say(w + "maybe", describe(maybe5(make5()[i])) + describe(maybe5(round ? undefined : null)));
    say(w + "branch", describe(branch5(make5()[i], true)) + describe(branch5(make5()[i], false)));
    say(w + "loop", loop5(make5()[i], 3));
    say(w + "carried", describe(carried5(make5()[i], 0)) + describe(carried5(make5()[i], 3)));
    say(w + "two", describe(two5(make5()[i], make5()[0])) + describe(two5(make5()[0], make5()[i])));
    say(w + "alias", alias5(make5()[i]));
  }
}

type W6 = { a: number; readonly b: number; c: number };
function make6(): W6[] { const list: W6[] = [{ a: 1, b: 2, c: 3 }, { a: 4, get b() { log.push('get b'); return 55; }, c: 6 }];  return list; }
function chain6(p: W6): W6 { p = { ...p, a: 10 }; p = { ...p, a: 11 }; p = { ...p, c: 30 }; p = { ...p, a: 10 }; return p; }
function copies6(p: W6): W6 { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function dropped6(p: W6): string { const q = { ...p, a: 10 }; const r = { ...q, a: 11 }; return String(r.a) + "," + typeof r.b + "," + String(r.c === null ? null : typeof r.c); }
function droppedCopy6(p: W6): string { const q = { ...p }; return String(q.a) + "," + typeof q.b + "," + typeof q.c + "," + Object.keys(q).join(); }
function kept6(p: W6): W6 { return { ...p, c: 30 }; }
function keptCopy6(p: W6): W6 { return { ...p }; }
function maybe6(p: W6 | undefined | null): W6 | { a: W6["a"] } { return { ...p, a: 10 }; }
function branch6(p: W6, f: boolean): W6 { let q: W6; if (f) q = { ...p, a: 10 }; else q = { ...p }; return { ...q, c: 30 }; }
function loop6(p: W6, n: number): string { let s = ""; for (let i = 0; i < n; i++) { const q = { ...p, a: 10 }; s += String(q.a) + typeof q.b + typeof q.c + ";"; } return s; }
function carried6(p: W6, n: number): W6 { for (let i = 0; i < n; i++) { p = { ...p, a: 10 }; p = { ...p }; } return p; }
function two6(p: W6, q: W6): W6 { return { ...p, ...q }; }
function alias6(p: W6): string { const q = { ...p, c: 30 }; q.a = 10; return describe(q) + " from " + describe(p); }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 2; i++) {
    const w = "written getter " + i + " ";
    say(w + "chain", describe(chain6(make6()[i])));
    say(w + "copies", describe(copies6(make6()[i])));
    say(w + "dropped", dropped6(make6()[i]));
    say(w + "droppedCopy", droppedCopy6(make6()[i]));
    say(w + "kept", describe(kept6(make6()[i])));
    say(w + "keptCopy", describe(keptCopy6(make6()[i])));
    say(w + "maybe", describe(maybe6(make6()[i])) + describe(maybe6(round ? undefined : null)));
    say(w + "branch", describe(branch6(make6()[i], true)) + describe(branch6(make6()[i], false)));
    say(w + "loop", loop6(make6()[i], 3));
    say(w + "carried", describe(carried6(make6()[i], 0)) + describe(carried6(make6()[i], 3)));
    say(w + "two", describe(two6(make6()[i], make6()[0])) + describe(two6(make6()[0], make6()[i])));
    say(w + "alias", alias6(make6()[i]));
  }
}

type W7 = { a: number; b: number; c: number };
function make7(): W7[] { const list: W7[] = [{ a: 1, b: 2, c: 3 }, { a: 4, b: 5, c: 6 }]; Object.defineProperty(list[1], 'c', { enumerable: false }); return list; }
function chain7(p: W7): W7 { p = { ...p, a: 10 }; p = { ...p, b: 20 }; p = { ...p, c: 30 }; p = { ...p, a: 10 }; return p; }
function copies7(p: W7): W7 { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function dropped7(p: W7): string { const q = { ...p, a: 10 }; const r = { ...q, b: 20 }; return String(r.a) + "," + typeof r.b + "," + String(r.c === null ? null : typeof r.c); }
function droppedCopy7(p: W7): string { const q = { ...p }; return String(q.a) + "," + typeof q.b + "," + typeof q.c + "," + Object.keys(q).join(); }
function kept7(p: W7): W7 { return { ...p, c: 30 }; }
function keptCopy7(p: W7): W7 { return { ...p }; }
function maybe7(p: W7 | undefined | null): W7 | { a: W7["a"] } { return { ...p, a: 10 }; }
function branch7(p: W7, f: boolean): W7 { let q: W7; if (f) q = { ...p, a: 10 }; else q = { ...p }; return { ...q, c: 30 }; }
function loop7(p: W7, n: number): string { let s = ""; for (let i = 0; i < n; i++) { const q = { ...p, a: 10 }; s += String(q.a) + typeof q.b + typeof q.c + ";"; } return s; }
function carried7(p: W7, n: number): W7 { for (let i = 0; i < n; i++) { p = { ...p, a: 10 }; p = { ...p }; } return p; }
function two7(p: W7, q: W7): W7 { return { ...p, ...q }; }
function alias7(p: W7): string { const q = { ...p, c: 30 }; q.a = 10; return describe(q) + " from " + describe(p); }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 2; i++) {
    const w = "hidden " + i + " ";
    say(w + "chain", describe(chain7(make7()[i])));
    say(w + "copies", describe(copies7(make7()[i])));
    say(w + "dropped", dropped7(make7()[i]));
    say(w + "droppedCopy", droppedCopy7(make7()[i]));
    say(w + "kept", describe(kept7(make7()[i])));
    say(w + "keptCopy", describe(keptCopy7(make7()[i])));
    say(w + "maybe", describe(maybe7(make7()[i])) + describe(maybe7(round ? undefined : null)));
    say(w + "branch", describe(branch7(make7()[i], true)) + describe(branch7(make7()[i], false)));
    say(w + "loop", loop7(make7()[i], 3));
    say(w + "carried", describe(carried7(make7()[i], 0)) + describe(carried7(make7()[i], 3)));
    say(w + "two", describe(two7(make7()[i], make7()[0])) + describe(two7(make7()[0], make7()[i])));
    say(w + "alias", alias7(make7()[i]));
  }
}

type W8 = { a: number; b: number; c: number };
function make8(): W8[] { const list: W8[] = [{ a: 1, b: 2, c: 3 }, { a: 4, b: 5, c: 6 }]; Object.freeze(list[1]); return list; }
function chain8(p: W8): W8 { p = { ...p, a: 10 }; p = { ...p, b: 20 }; p = { ...p, c: 30 }; p = { ...p, a: 10 }; return p; }
function copies8(p: W8): W8 { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function dropped8(p: W8): string { const q = { ...p, a: 10 }; const r = { ...q, b: 20 }; return String(r.a) + "," + typeof r.b + "," + String(r.c === null ? null : typeof r.c); }
function droppedCopy8(p: W8): string { const q = { ...p }; return String(q.a) + "," + typeof q.b + "," + typeof q.c + "," + Object.keys(q).join(); }
function kept8(p: W8): W8 { return { ...p, c: 30 }; }
function keptCopy8(p: W8): W8 { return { ...p }; }
function maybe8(p: W8 | undefined | null): W8 | { a: W8["a"] } { return { ...p, a: 10 }; }
function branch8(p: W8, f: boolean): W8 { let q: W8; if (f) q = { ...p, a: 10 }; else q = { ...p }; return { ...q, c: 30 }; }
function loop8(p: W8, n: number): string { let s = ""; for (let i = 0; i < n; i++) { const q = { ...p, a: 10 }; s += String(q.a) + typeof q.b + typeof q.c + ";"; } return s; }
function carried8(p: W8, n: number): W8 { for (let i = 0; i < n; i++) { p = { ...p, a: 10 }; p = { ...p }; } return p; }
function two8(p: W8, q: W8): W8 { return { ...p, ...q }; }
function alias8(p: W8): string { const q = { ...p, c: 30 }; q.a = 10; return describe(q) + " from " + describe(p); }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 2; i++) {
    const w = "frozen " + i + " ";
    say(w + "chain", describe(chain8(make8()[i])));
    say(w + "copies", describe(copies8(make8()[i])));
    say(w + "dropped", dropped8(make8()[i]));
    say(w + "droppedCopy", droppedCopy8(make8()[i]));
    say(w + "kept", describe(kept8(make8()[i])));
    say(w + "keptCopy", describe(keptCopy8(make8()[i])));
    say(w + "maybe", describe(maybe8(make8()[i])) + describe(maybe8(round ? undefined : null)));
    say(w + "branch", describe(branch8(make8()[i], true)) + describe(branch8(make8()[i], false)));
    say(w + "loop", loop8(make8()[i], 3));
    say(w + "carried", describe(carried8(make8()[i], 0)) + describe(carried8(make8()[i], 3)));
    say(w + "two", describe(two8(make8()[i], make8()[0])) + describe(two8(make8()[0], make8()[i])));
    say(w + "alias", alias8(make8()[i]));
  }
}

type W9 = { a: number | string; b: number | undefined; c: number | null };
function make9(): W9[] { const list: W9[] = [{ a: 1, b: 2, c: 3 }, { a: 'x', b: undefined, c: null }, { a: 0.5, b: -0, c: 2 ** 40 }];  return list; }
function chain9(p: W9): W9 { p = { ...p, a: 10 }; p = { ...p, b: 20 }; p = { ...p, c: 30 }; p = { ...p, a: 10 }; return p; }
function copies9(p: W9): W9 { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function dropped9(p: W9): string { const q = { ...p, a: 10 }; const r = { ...q, b: 20 }; return String(r.a) + "," + typeof r.b + "," + String(r.c === null ? null : typeof r.c); }
function droppedCopy9(p: W9): string { const q = { ...p }; return String(q.a) + "," + typeof q.b + "," + typeof q.c + "," + Object.keys(q).join(); }
function kept9(p: W9): W9 { return { ...p, c: 30 }; }
function keptCopy9(p: W9): W9 { return { ...p }; }
function maybe9(p: W9 | undefined | null): W9 | { a: W9["a"] } { return { ...p, a: 10 }; }
function branch9(p: W9, f: boolean): W9 { let q: W9; if (f) q = { ...p, a: 10 }; else q = { ...p }; return { ...q, c: 30 }; }
function loop9(p: W9, n: number): string { let s = ""; for (let i = 0; i < n; i++) { const q = { ...p, a: 10 }; s += String(q.a) + typeof q.b + typeof q.c + ";"; } return s; }
function carried9(p: W9, n: number): W9 { for (let i = 0; i < n; i++) { p = { ...p, a: 10 }; p = { ...p }; } return p; }
function two9(p: W9, q: W9): W9 { return { ...p, ...q }; }
function alias9(p: W9): string { const q = { ...p, c: 30 }; q.a = 10; return describe(q) + " from " + describe(p); }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 3; i++) {
    const w = "union " + i + " ";
    say(w + "chain", describe(chain9(make9()[i])));
    say(w + "copies", describe(copies9(make9()[i])));
    say(w + "dropped", dropped9(make9()[i]));
    say(w + "droppedCopy", droppedCopy9(make9()[i]));
    say(w + "kept", describe(kept9(make9()[i])));
    say(w + "keptCopy", describe(keptCopy9(make9()[i])));
    say(w + "maybe", describe(maybe9(make9()[i])) + describe(maybe9(round ? undefined : null)));
    say(w + "branch", describe(branch9(make9()[i], true)) + describe(branch9(make9()[i], false)));
    say(w + "loop", loop9(make9()[i], 3));
    say(w + "carried", describe(carried9(make9()[i], 0)) + describe(carried9(make9()[i], 3)));
    say(w + "two", describe(two9(make9()[i], make9()[0])) + describe(two9(make9()[0], make9()[i])));
    say(w + "alias", alias9(make9()[i]));
  }
}

type W10 = { a: number; b: number; c: number };
function make10(): W10[] { const list: W10[] = [{ a: 1, b: 2, c: 3 }, { a: 4, b: 5, c: 6 }]; list[1].a = 0.25; list[1].c = 2 ** 33; list[0].b = -0; return list; }
function chain10(p: W10): W10 { p = { ...p, a: 10 }; p = { ...p, b: 20 }; p = { ...p, c: 30 }; p = { ...p, a: 10 }; return p; }
function copies10(p: W10): W10 { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function dropped10(p: W10): string { const q = { ...p, a: 10 }; const r = { ...q, b: 20 }; return String(r.a) + "," + typeof r.b + "," + String(r.c === null ? null : typeof r.c); }
function droppedCopy10(p: W10): string { const q = { ...p }; return String(q.a) + "," + typeof q.b + "," + typeof q.c + "," + Object.keys(q).join(); }
function kept10(p: W10): W10 { return { ...p, c: 30 }; }
function keptCopy10(p: W10): W10 { return { ...p }; }
function maybe10(p: W10 | undefined | null): W10 | { a: W10["a"] } { return { ...p, a: 10 }; }
function branch10(p: W10, f: boolean): W10 { let q: W10; if (f) q = { ...p, a: 10 }; else q = { ...p }; return { ...q, c: 30 }; }
function loop10(p: W10, n: number): string { let s = ""; for (let i = 0; i < n; i++) { const q = { ...p, a: 10 }; s += String(q.a) + typeof q.b + typeof q.c + ";"; } return s; }
function carried10(p: W10, n: number): W10 { for (let i = 0; i < n; i++) { p = { ...p, a: 10 }; p = { ...p }; } return p; }
function two10(p: W10, q: W10): W10 { return { ...p, ...q }; }
function alias10(p: W10): string { const q = { ...p, c: 30 }; q.a = 10; return describe(q) + " from " + describe(p); }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 2; i++) {
    const w = "stored " + i + " ";
    say(w + "chain", describe(chain10(make10()[i])));
    say(w + "copies", describe(copies10(make10()[i])));
    say(w + "dropped", dropped10(make10()[i]));
    say(w + "droppedCopy", droppedCopy10(make10()[i]));
    say(w + "kept", describe(kept10(make10()[i])));
    say(w + "keptCopy", describe(keptCopy10(make10()[i])));
    say(w + "maybe", describe(maybe10(make10()[i])) + describe(maybe10(round ? undefined : null)));
    say(w + "branch", describe(branch10(make10()[i], true)) + describe(branch10(make10()[i], false)));
    say(w + "loop", loop10(make10()[i], 3));
    say(w + "carried", describe(carried10(make10()[i], 0)) + describe(carried10(make10()[i], 3)));
    say(w + "two", describe(two10(make10()[i], make10()[0])) + describe(two10(make10()[0], make10()[i])));
    say(w + "alias", alias10(make10()[i]));
  }
}

type W11 = { a: number; b: number; c: number; [mark]?: string };
function make11(): W11[] { const list: W11[] = [{ a: 1, b: 2, c: 3 }, { a: 4, [mark]: 'm', b: 5, c: 6 }];  return list; }
function chain11(p: W11): W11 { p = { ...p, a: 10 }; p = { ...p, b: 20 }; p = { ...p, c: 30 }; p = { ...p, a: 10 }; return p; }
function copies11(p: W11): W11 { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function dropped11(p: W11): string { const q = { ...p, a: 10 }; const r = { ...q, b: 20 }; return String(r.a) + "," + typeof r.b + "," + String(r.c === null ? null : typeof r.c); }
function droppedCopy11(p: W11): string { const q = { ...p }; return String(q.a) + "," + typeof q.b + "," + typeof q.c + "," + Object.keys(q).join(); }
function kept11(p: W11): W11 { return { ...p, c: 30 }; }
function keptCopy11(p: W11): W11 { return { ...p }; }
function maybe11(p: W11 | undefined | null): W11 | { a: W11["a"] } { return { ...p, a: 10 }; }
function branch11(p: W11, f: boolean): W11 { let q: W11; if (f) q = { ...p, a: 10 }; else q = { ...p }; return { ...q, c: 30 }; }
function loop11(p: W11, n: number): string { let s = ""; for (let i = 0; i < n; i++) { const q = { ...p, a: 10 }; s += String(q.a) + typeof q.b + typeof q.c + ";"; } return s; }
function carried11(p: W11, n: number): W11 { for (let i = 0; i < n; i++) { p = { ...p, a: 10 }; p = { ...p }; } return p; }
function two11(p: W11, q: W11): W11 { return { ...p, ...q }; }
function alias11(p: W11): string { const q = { ...p, c: 30 }; q.a = 10; return describe(q) + " from " + describe(p); }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 2; i++) {
    const w = "symbol " + i + " ";
    say(w + "chain", describe(chain11(make11()[i])));
    say(w + "copies", describe(copies11(make11()[i])));
    say(w + "dropped", dropped11(make11()[i]));
    say(w + "droppedCopy", droppedCopy11(make11()[i]));
    say(w + "kept", describe(kept11(make11()[i])));
    say(w + "keptCopy", describe(keptCopy11(make11()[i])));
    say(w + "maybe", describe(maybe11(make11()[i])) + describe(maybe11(round ? undefined : null)));
    say(w + "branch", describe(branch11(make11()[i], true)) + describe(branch11(make11()[i], false)));
    say(w + "loop", loop11(make11()[i], 3));
    say(w + "carried", describe(carried11(make11()[i], 0)) + describe(carried11(make11()[i], 3)));
    say(w + "two", describe(two11(make11()[i], make11()[0])) + describe(two11(make11()[0], make11()[i])));
    say(w + "alias", alias11(make11()[i]));
  }
}

type W12 = { a: number; b: number; c: number; [index: number]: string };
function make12(): W12[] { const list: W12[] = [{ a: 1, b: 2, c: 3 }, { a: 4, b: 5, c: 6, 1: 'one' }, { a: 7, b: 8, c: 9 }]; list[2][0] = 'zero'; return list; }
function chain12(p: W12): W12 { p = { ...p, a: 10 }; p = { ...p, b: 20 }; p = { ...p, c: 30 }; p = { ...p, a: 10 }; return p; }
function copies12(p: W12): W12 { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function dropped12(p: W12): string { const q = { ...p, a: 10 }; const r = { ...q, b: 20 }; return String(r.a) + "," + typeof r.b + "," + String(r.c === null ? null : typeof r.c); }
function droppedCopy12(p: W12): string { const q = { ...p }; return String(q.a) + "," + typeof q.b + "," + typeof q.c + "," + Object.keys(q).join(); }
function kept12(p: W12): W12 { return { ...p, c: 30 }; }
function keptCopy12(p: W12): W12 { return { ...p }; }
function maybe12(p: W12 | undefined | null): W12 | { a: W12["a"] } { return { ...p, a: 10 }; }
function branch12(p: W12, f: boolean): W12 { let q: W12; if (f) q = { ...p, a: 10 }; else q = { ...p }; return { ...q, c: 30 }; }
function loop12(p: W12, n: number): string { let s = ""; for (let i = 0; i < n; i++) { const q = { ...p, a: 10 }; s += String(q.a) + typeof q.b + typeof q.c + ";"; } return s; }
function carried12(p: W12, n: number): W12 { for (let i = 0; i < n; i++) { p = { ...p, a: 10 }; p = { ...p }; } return p; }
function two12(p: W12, q: W12): W12 { return { ...p, ...q }; }
function alias12(p: W12): string { const q = { ...p, c: 30 }; q.a = 10; return describe(q) + " from " + describe(p); }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 3; i++) {
    const w = "index " + i + " ";
    say(w + "chain", describe(chain12(make12()[i])));
    say(w + "copies", describe(copies12(make12()[i])));
    say(w + "dropped", dropped12(make12()[i]));
    say(w + "droppedCopy", droppedCopy12(make12()[i]));
    say(w + "kept", describe(kept12(make12()[i])));
    say(w + "keptCopy", describe(keptCopy12(make12()[i])));
    say(w + "maybe", describe(maybe12(make12()[i])) + describe(maybe12(round ? undefined : null)));
    say(w + "branch", describe(branch12(make12()[i], true)) + describe(branch12(make12()[i], false)));
    say(w + "loop", loop12(make12()[i], 3));
    say(w + "carried", describe(carried12(make12()[i], 0)) + describe(carried12(make12()[i], 3)));
    say(w + "two", describe(two12(make12()[i], make12()[0])) + describe(two12(make12()[0], make12()[i])));
    say(w + "alias", alias12(make12()[i]));
  }
}

type W13 = { a: number; b: number; c: number };
function make13(): W13[] { const list: W13[] = [{ a: 1, b: 2, c: 3 }, { a: 4, b: 5, c: 6 }]; Object.setPrototypeOf(list[1], { a: 100, z: 26 }); Object.create(list[0]); return list; }
function chain13(p: W13): W13 { p = { ...p, a: 10 }; p = { ...p, b: 20 }; p = { ...p, c: 30 }; p = { ...p, a: 10 }; return p; }
function copies13(p: W13): W13 { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function dropped13(p: W13): string { const q = { ...p, a: 10 }; const r = { ...q, b: 20 }; return String(r.a) + "," + typeof r.b + "," + String(r.c === null ? null : typeof r.c); }
function droppedCopy13(p: W13): string { const q = { ...p }; return String(q.a) + "," + typeof q.b + "," + typeof q.c + "," + Object.keys(q).join(); }
function kept13(p: W13): W13 { return { ...p, c: 30 }; }
function keptCopy13(p: W13): W13 { return { ...p }; }
function maybe13(p: W13 | undefined | null): W13 | { a: W13["a"] } { return { ...p, a: 10 }; }
function branch13(p: W13, f: boolean): W13 { let q: W13; if (f) q = { ...p, a: 10 }; else q = { ...p }; return { ...q, c: 30 }; }
function loop13(p: W13, n: number): string { let s = ""; for (let i = 0; i < n; i++) { const q = { ...p, a: 10 }; s += String(q.a) + typeof q.b + typeof q.c + ";"; } return s; }
function carried13(p: W13, n: number): W13 { for (let i = 0; i < n; i++) { p = { ...p, a: 10 }; p = { ...p }; } return p; }
function two13(p: W13, q: W13): W13 { return { ...p, ...q }; }
function alias13(p: W13): string { const q = { ...p, c: 30 }; q.a = 10; return describe(q) + " from " + describe(p); }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 2; i++) {
    const w = "prototype " + i + " ";
    say(w + "chain", describe(chain13(make13()[i])));
    say(w + "copies", describe(copies13(make13()[i])));
    say(w + "dropped", dropped13(make13()[i]));
    say(w + "droppedCopy", droppedCopy13(make13()[i]));
    say(w + "kept", describe(kept13(make13()[i])));
    say(w + "keptCopy", describe(keptCopy13(make13()[i])));
    say(w + "maybe", describe(maybe13(make13()[i])) + describe(maybe13(round ? undefined : null)));
    say(w + "branch", describe(branch13(make13()[i], true)) + describe(branch13(make13()[i], false)));
    say(w + "loop", loop13(make13()[i], 3));
    say(w + "carried", describe(carried13(make13()[i], 0)) + describe(carried13(make13()[i], 3)));
    say(w + "two", describe(two13(make13()[i], make13()[0])) + describe(two13(make13()[0], make13()[i])));
    say(w + "alias", alias13(make13()[i]));
  }
}

type W14 = { a: string; b: string[]; c: { d: number } | null };
function make14(): W14[] { const list: W14[] = [{ a: 'x', b: ['y'], c: { d: 1 } }, { a: 'xx', b: [], c: null }];  return list; }
function chain14(p: W14): W14 { p = { ...p, a: 'r' }; p = { ...p, b: ['s'] }; p = { ...p, c: { d: 9 } }; p = { ...p, a: 'r' }; return p; }
function copies14(p: W14): W14 { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function dropped14(p: W14): string { const q = { ...p, a: 'r' }; const r = { ...q, b: ['s'] }; return String(r.a) + "," + typeof r.b + "," + String(r.c === null ? null : typeof r.c); }
function droppedCopy14(p: W14): string { const q = { ...p }; return String(q.a) + "," + typeof q.b + "," + typeof q.c + "," + Object.keys(q).join(); }
function kept14(p: W14): W14 { return { ...p, c: { d: 9 } }; }
function keptCopy14(p: W14): W14 { return { ...p }; }
function maybe14(p: W14 | undefined | null): W14 | { a: W14["a"] } { return { ...p, a: 'r' }; }
function branch14(p: W14, f: boolean): W14 { let q: W14; if (f) q = { ...p, a: 'r' }; else q = { ...p }; return { ...q, c: { d: 9 } }; }
function loop14(p: W14, n: number): string { let s = ""; for (let i = 0; i < n; i++) { const q = { ...p, a: 'r' }; s += String(q.a) + typeof q.b + typeof q.c + ";"; } return s; }
function carried14(p: W14, n: number): W14 { for (let i = 0; i < n; i++) { p = { ...p, a: 'r' }; p = { ...p }; } return p; }
function two14(p: W14, q: W14): W14 { return { ...p, ...q }; }
function alias14(p: W14): string { const q = { ...p, c: { d: 9 } }; q.a = 'r'; return describe(q) + " from " + describe(p); }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 2; i++) {
    const w = "texts " + i + " ";
    say(w + "chain", describe(chain14(make14()[i])));
    say(w + "copies", describe(copies14(make14()[i])));
    say(w + "dropped", dropped14(make14()[i]));
    say(w + "droppedCopy", droppedCopy14(make14()[i]));
    say(w + "kept", describe(kept14(make14()[i])));
    say(w + "keptCopy", describe(keptCopy14(make14()[i])));
    say(w + "maybe", describe(maybe14(make14()[i])) + describe(maybe14(round ? undefined : null)));
    say(w + "branch", describe(branch14(make14()[i], true)) + describe(branch14(make14()[i], false)));
    say(w + "loop", loop14(make14()[i], 3));
    say(w + "carried", describe(carried14(make14()[i], 0)) + describe(carried14(make14()[i], 3)));
    say(w + "two", describe(two14(make14()[i], make14()[0])) + describe(two14(make14()[0], make14()[i])));
    say(w + "alias", alias14(make14()[i]));
  }
}

type W15 = { a: number; b(): number; c: () => number };
function make15(): W15[] { const list: W15[] = [{ a: 1, b() { return this.a + 1; }, c: () => 3 }, { a: 4, b() { return this.a + 2; }, c: () => 6 }];  return list; }
function chain15(p: W15): W15 { p = { ...p, a: 10 }; p = { ...p, b: function (this: { a: number }) { return this.a + 20; } }; p = { ...p, c: () => 30 }; p = { ...p, a: 10 }; return p; }
function copies15(p: W15): W15 { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function dropped15(p: W15): string { const q = { ...p, a: 10 }; const r = { ...q, b: function (this: { a: number }) { return this.a + 20; } }; return String(r.a) + "," + typeof r.b + "," + String(r.c === null ? null : typeof r.c); }
function droppedCopy15(p: W15): string { const q = { ...p }; return String(q.a) + "," + typeof q.b + "," + typeof q.c + "," + Object.keys(q).join(); }
function kept15(p: W15): W15 { return { ...p, c: () => 30 }; }
function keptCopy15(p: W15): W15 { return { ...p }; }
function maybe15(p: W15 | undefined | null): W15 | { a: W15["a"] } { return { ...p, a: 10 }; }
function branch15(p: W15, f: boolean): W15 { let q: W15; if (f) q = { ...p, a: 10 }; else q = { ...p }; return { ...q, c: () => 30 }; }
function loop15(p: W15, n: number): string { let s = ""; for (let i = 0; i < n; i++) { const q = { ...p, a: 10 }; s += String(q.a) + typeof q.b + typeof q.c + ";"; } return s; }
function carried15(p: W15, n: number): W15 { for (let i = 0; i < n; i++) { p = { ...p, a: 10 }; p = { ...p }; } return p; }
function two15(p: W15, q: W15): W15 { return { ...p, ...q }; }
function alias15(p: W15): string { const q = { ...p, c: () => 30 }; q.a = 10; return describe(q) + " from " + describe(p); }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 2; i++) {
    const w = "methods " + i + " ";
    say(w + "chain", describe(chain15(make15()[i])));
    say(w + "copies", describe(copies15(make15()[i])));
    say(w + "dropped", dropped15(make15()[i]));
    say(w + "droppedCopy", droppedCopy15(make15()[i]));
    say(w + "kept", describe(kept15(make15()[i])));
    say(w + "keptCopy", describe(keptCopy15(make15()[i])));
    say(w + "maybe", describe(maybe15(make15()[i])) + describe(maybe15(round ? undefined : null)));
    say(w + "branch", describe(branch15(make15()[i], true)) + describe(branch15(make15()[i], false)));
    say(w + "loop", loop15(make15()[i], 3));
    say(w + "carried", describe(carried15(make15()[i], 0)) + describe(carried15(make15()[i], 3)));
    say(w + "two", describe(two15(make15()[i], make15()[0])) + describe(two15(make15()[0], make15()[i])));
    say(w + "alias", alias15(make15()[i]));
  }
}

// GENERATED: make7 make11 loop15
// CHECK-LABEL: function {{*}}name="make7"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<undefined|null|[[L_1]]> site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_3]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<undefined|null|[[L_1]]> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = ElemGet v1, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_1]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v7 = String string="c"
// CHECK-NEXT: v8 = Boolean
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|boolean}
// CHECK-NEXT: v10 = NewObject -, v9 layout=[[L_6]] fields=[1]
// CHECK-NEXT: v11 = FinishObject v10
// CHECK-NEXT: v12 = Call v3, v2, v6, v7, v11 calleeName="Object.defineProperty"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[L_1]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make11"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<undefined|null|[[L_8]]> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_10]]
// CHECK-NEXT: v1 = Integer integer=4
// CHECK-NEXT: v2 = Convert v1 declared={type=number}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="mark"
// CHECK-NEXT: v5 = ToPropertyKey v4
// CHECK-NEXT: v6 = String string="m"
// CHECK-NEXT: v7 = NewObject -, v2 layout=[[L_8]] fields=[0]
// CHECK-NEXT: ElemDefine v7, v5, v6
// CHECK-NEXT: v9 = Integer integer=5
// CHECK-NEXT: v10 = Convert v9 declared={type=number}
// CHECK-NEXT: PropDefine v7, v10 key="b"
// CHECK-NEXT: v12 = Integer integer=6
// CHECK-NEXT: v13 = Convert v12 declared={type=number}
// CHECK-NEXT: PropDefine v7, v13 key="c"
// CHECK-NEXT: v15 = FinishObject v7
// CHECK-NEXT: v16 = NewArray v0, v15 contents=undefined|null|[[L_8]]
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|Array<undefined|null|[[L_8]]> site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="loop15"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_13]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_15]]}] results=[{type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_13]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = String string=""
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_18]]}
// CHECK-NEXT: Jump -> next b2(v3, v5)
// CHECK-NEXT: b2(v6: undefined|null|string, v7: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = Less v7, v1
// CHECK-NEXT: Branch v9 -> taken b3(| 0, 1), notTaken b6(| 0, 1)
// CHECK-NEXT: b3(v10, v11):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = NewObject layout=[[L_13]]
// CHECK-NEXT: CopyDataProperties v12, v0
// CHECK-NEXT: v14 = Integer integer=10
// CHECK-NEXT: v15 = Convert v14 declared={type=number}
// CHECK-NEXT: PropDefine v12, v15 key="a"
// CHECK-NEXT: v17 = FinishObject v12
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[L_13]] site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v19 = Builtin builtin=String
// CHECK-NEXT: v20 = PropGet v18 key="a"
// CHECK-NEXT: v21 = Call v19, -, v20 calleeName="String"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = PropGet v18 key="b"
// CHECK-NEXT: v24 = TypeOf v23
// CHECK-NEXT: v25 = Add v22, v24
// CHECK-NEXT: v26 = PropGet v18 key="c"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|[[f_21]] site=[[w_22]]} illTypedCause=Assertion
// CHECK-NEXT: v28 = TypeOf v27
// CHECK-NEXT: v29 = Add v25, v28
// CHECK-NEXT: v30 = String string=";"
// CHECK-NEXT: v31 = Add v29, v30
// CHECK-NEXT: v32 = Add v6, v31
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v34 = Increment v10
// CHECK-NEXT: v35 = Convert v34 declared={type=number site=[[w_18]]}
// CHECK-NEXT: Jump -> next b2(v33, v35)
// CHECK-NEXT: b6(v36, v37):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v38 = Convert v6 declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v38
// CHECK-NEXT: }
