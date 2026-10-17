// The order of evaluation in destructuring assignments whose targets are private and public fields, with type annotations.
declare const console: { log(...a: unknown[]): void };
const log: string[] = [];
function note<T>(s: string, v: T): T { log.push(s); return v; }
function row(label: string, f: () => unknown) { log.length = 0; let r: string; try { r = String(f()); } catch (e) { r = "threw " + (e as Error).name; } console.log(label + ": " + r + " [" + log.join(" ") + "]"); }
class Source { get a(): number { return note("get a", 7); } get b(): string { return note("get b", "s"); } }
const src = (): Source => new Source();
class P {
  x = 0; t = ""; #p = 0; static #s = 0; static q = 0;
  static priv(o: P, s: Source) { ({ a: note("target", o).#p } = s); return o.#p; }
  static pub(o: P, s: Source) { ({ a: note("target", o).x } = s); return o.x; }
  static two(o: P, s: Source) { ({ a: note("t1", o).x, b: note("t2", o).t } = s); return o.x + o.t; }
  static stat(s: Source) { ({ a: note("target", P).#s } = s); return P.#s; }
  static statPub(s: Source) { ({ a: note("target", P).q } = s); return P.q; }
  static dflt(o: P, s: { a?: number }) { ({ a: note("target", o).x = note("default", 5) } = s); return o.x; }
  own(s: Source) { ({ a: this.x, b: this.t } = s); return this.x + this.t; }
}
row("a private field", () => P.priv(new P(), src()));
row("a public field", () => P.pub(new P(), src()));
row("two fields", () => P.two(new P(), src()));
row("a static private field", () => P.stat(src()));
row("a static public field", () => P.statPub(src()));
row("with a default", () => P.dflt(new P(), { get a() { note("get a", 0); return undefined; } }));
row("this", () => new P().own(src()));
row("a literal's field", () => { const o = { k: 0 }; ({ a: note("target", o).k } = src()); return o.k; });
row("an element", () => { const l = [0, 0]; ({ a: note("target", l)[note("index", 1)] } = src()); return l.join(); });
row("locals", () => { let a = 0, b = ""; ({ a, b } = src()); return a + b; });
row("rest", () => { const o: { r?: { b: string } } = {}; let a = 0; ({ a, ...note("target", o).r } = { a: note("made", 1), b: "s" }); return a + " " + Object.keys(o.r!).join(); });
row("in a hot loop", () => { const o = new P(); let t = 0; for (let i = 0; i < 1000; i++) { ({ a: o.x } = { a: i }); t += o.x; } return t; });
