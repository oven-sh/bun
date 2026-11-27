// Iterations that find properties of globalThis through addresses asked for in the preheader: not filed yet, changed on the way, stored under conditions, written back where an iteration restarts.
const g: any = globalThis;
const xs: number[] = JSON.parse("[" + Array.from({ length: 24 }, (_, k) => (k * 37) % 11).join() + "]");
const late: any[] = JSON.parse('[1,2,3,4,5,6,7,8,9,10,"eleven",12,13]');
const holes: any[] = JSON.parse("[1,2,3,4,5,6,7]"); delete holes[5];
const objects: any[] = JSON.parse('[{"v":1},{"v":2},{"w":4},{"v":"five"},{"v":6}]');
let calls = 0;
function call() { return ++calls % 3; }
function show(name: string, names: string[], run: (round: number) => unknown): void {
  const said: string[] = [];
  for (let round = 0; round < 4; round++) {
    try { said.push(String(run(round))); } catch (error) { said.push((error as Error).name); }
    said.push(names.map(key => { try { const value = g[key]; return typeof value === "object" && value ? JSON.stringify(value) : String(value); } catch (error) { return "!"; } }).join());
  }
  console.log(name, said.join(" "), calls);
}
show("never filed", ["a1", "a2"], () => { let s: any = 0; for (let i = 0; i < xs.length; i++) { s += g.a1?.x ?? 1; s = (s + xs[i]!) | 0; if (i & 1) g.a2 = 1; } return s; });
show("absent at first", ["b1"], round => { let s = 0; for (let i = 0; i < xs.length; i++) { s = (s + (g.b1 ?? 0) + xs[i]!) | 0; if (i === 9 && round === 1) g.b1 = 5; } return s; });
show("stored and read", ["c1"], () => { let s = 0; for (let i = 0; i < xs.length; i++) { g.c1 = xs[i]!; s = (s + g.c1) | 0; } return s; });
g.d1 = 0; g.d2 = 1;
show("sum that meets a string", ["d1", "d2"], round => { let s: any = 0; for (let i = 0; i < late.length; i++) { g.d1 += 1; g.d2 = i; s = (s + late[i]) | 0; if (i === 4 && round === 2) g.d1 = "nine"; } return s; });
g.e1 = 0;
show("hole behind a store", ["e1"], () => { let s = 0; for (let i = 0; i < holes.length; i++) { g.e1 = i; s = (s + holes[i]) | 0; } return s; });
g.f1 = 0; g.f2 = 1;
show("field behind a store", ["f1", "f2"], () => { let s = 0; for (let i = 0; i < objects.length; i++) { g.f1 += 2; s = (s + objects[i].v) | 0; g.f2 = s; } return s; });
g.h1 = 0;
show("stored under a condition", ["h1", "h2"], () => { let s = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (x > g.h1) g.h1 = x; if (x === 4) g.h2 = "t" + i; s = (s + x) | 0; } return s; });
show("a call between", ["h1", "j1"], round => { let s = 0; for (let i = 0; i < xs.length; i++) { g.j1 = i; s = (s + g.h1 + call()) | 0; if (i === 5 && round === 1) Object.defineProperty(g, "j1", { configurable: true, enumerable: true, get: () => 41, set: () => { calls += 10; } }); } return s; });
g.k1 = 1.5; g.k2 = "p";
show("kinds", ["k1", "k2"], round => { let s: any = 0; for (let i = 0; i < xs.length; i++) { g.k1 += 0.5; g.k2 = xs[i]! > 5 ? "big" : "small"; s += g.k2.length; if (i === 3 && round === 1) g.k1 = { valueOf: () => 2 }; } return s; });
g.l1 = 0;
show("read-only on the way", ["l1"], round => { let s = 0; for (let i = 0; i < xs.length; i++) { s = (s + xs[i]!) | 0; g.l1 = s; if (i === 7 && round === 2) Object.defineProperty(g, "l1", { configurable: true, enumerable: true, writable: false, value: 7 }); } return s; });
g.m1 = [1, 2]; g.m2 = 0;
show("list in a global", ["m1", "m2"], () => { let s = 0; for (let i = 0; i < xs.length; i++) { s = (s + g.m1[i & 1]) | 0; g.m2++; if (i === 6) g.m1 = [s, "x"]; } return s; });
show("outer loop", ["n1", "n2"], () => { let s = 0; for (let k = 0; k < 3; k++) { g.n1 = k; for (let i = 0; i < xs.length; i++) { g.n2 = (g.n2 ?? 0) + xs[i]!; s = (s + g.n1) | 0; } if (k === 1) delete g.n2; } return s; });
show("grown on the way", ["o1", "o9"], round => { let s = 0; g.o1 = 0; for (let i = 0; i < xs.length; i++) { g.o1 += xs[i]!; s = (s + g.o1) | 0; if (i === 11) for (let k = 0; k < 20; k++) g["o" + (round * 100 + k + 2)] = k; } return s; });
function inline(x: number) { g.p1 = x; return g.p1; }
show("in a copied callee", ["p1"], () => { let s = 0; for (let i = 0; i < late.length; i++) s = (s + inline(late[i])) | 0; return s; });
