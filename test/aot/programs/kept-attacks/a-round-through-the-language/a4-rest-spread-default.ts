// A round through the language: rest spread default. It prints what plain Bun prints.
function show(label: string, f: () => unknown) {
  try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", (e as any)?.name ?? String(e)); }
}
function total(...xs: number[]): number { let s = 0; for (const x of xs) s += x; return s; }
function total2(first: number, ...xs: number[]): number { let s = first; for (let i = 0; i < xs.length; i++) s += xs[i]; return s; }
function names(...ps: { n: string }[]): string { let s = ""; for (const p of ps) s += p.n.length; return s; }
function dflt(a: number = 5, b: string = "x"): string { return b + (a + 1); }
function three(a: number, b: number, c: number): number { return a + b + c; }
const T: any = total, T2: any = total2, N: any = names, D: any = dflt, H: any = three;
show("total", () => total(1, 2, 3));
show("total-any", () => T("a", {}, 1));
show("total-spread", () => total(...(["a", "b"] as any)));
show("total-apply", () => total.apply(null, ["x", 2] as any));
show("total-call", () => total.call(null, null as any, undefined as any));
show("total2-any", () => T2(1, "b", [3]));
show("total2-any2", () => T2("f", 1, 2));
show("total2-spread", () => total2(1, ...([{}, "z"] as any)));
show("names", () => names({ n: "ab" }, { n: "c" }));
show("names-any", () => N({ n: 5 }, { n: [1, 2] }));
show("names-any2", () => N("str", 4));
show("names-bind", () => N.bind(null, { n: { length: "L" } })({ n: "q" }));
show("dflt", () => dflt());
show("dflt-any", () => D(undefined, 7));
show("dflt-any2", () => D("z"));
show("dflt-any3", () => D(null, null));
show("three-spread", () => three(...([1, "2", 3] as any as [number, number, number])));
show("three-spread2", () => H(...[1]));
show("three-spread3", () => H(...["a", "b", "c", "d"]));
show("three-iter", () => H(...new Set(["q", 1, {}])));
