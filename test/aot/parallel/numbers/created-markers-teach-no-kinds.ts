// A slot takes undefined and null as markers that the type of its values lacks: a creation that stores one tells later stores nothing of that kind.
class Part { n: number; constructor(n: number) { this.n = n; } }
const key = (k: string) => (process.argv[2] === "q" ? "?" : k);
const putf0 = (o: any, v: any): void => { o.f0 = v; };
const putf1 = (o: any, v: any): void => { o.f1 = v; };
class Body { f0: number[]; f1: boolean;
constructor(o: any) { this.f0 = o.f0; this.f1 = o.f1; }
m_f0(): string { let n = 0; for (let i = 0; i < 4; i++) { if (this.f0 === undefined) n++; if ((this.f0 as any) === null) n += 10; } return `${n} ${typeof this.f0} ${this.f0 == null}`; }
s_f0(): string { return this.f0 ? "yes" : "no"; }
m_f1(): string { let n = 0; for (let i = 0; i < 4; i++) { if (this.f1 === undefined) n++; if ((this.f1 as any) === null) n += 10; } return `${n} ${typeof this.f1} ${this.f1 == null}`; }
s_f1(): string { return this.f1 ? "yes" : "no"; } }

const shown = (v: any): string => (typeof v === "object" && v !== null ? "o" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v + v);
const values: any[] = [undefined, {}, null, 10n, 2.5, [8], 3, undefined, null];
const fills: ((v: any) => any)[] = [v => { const b: any = new Body({ f0: [2, 3], f1: true }); delete b.f1; b.f1 = v; return b; }, v => { const b: any = new Body({ f0: [2, 3], f1: v }); b.f1 = false; b.f1 = v; return b; }, v => { const b: any = new Body({ f0: [2, 3], f1: true }); b["f1"] = v; return b; }, v => new Body({ f0: [2, 3], f1: v }), v => new Body({ f0: v, f1: false }), v => { const b: any = new Body({ f0: [2, 3], f1: v }); b.f1 = false; b.f1 = v; return b; }, v => { const b: any = new Body({ f0: [2, 3], f1: true }); b["f1"] = v; return b; }];
const lines: string[] = [];
for (let turn = 0; turn < 3; turn++) for (const value of values) for (const fill of fills) {
  let said = "";
  try { const b = fill(value); said = [b.m_f0(), b.s_f0(), b.m_f1(), b.s_f1()].join(" ") + " " + [b.f0, b.f1].map(shown).join() + " " + Object.keys(b).join(); } catch (e: any) { said = e.constructor.name; }
  lines.push(said);
}
console.log(lines.join("\n"));
