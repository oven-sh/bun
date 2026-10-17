// Records, instances, classes, arrays and parsed data are frozen, sealed or made non-extensible, and typed code stores to them.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
type Item = { id: number; n: number; tag?: string };
class Point { x = 1; y = 2; sum(): number { return this.x + this.y } }
function set(x: Item, v: number): number { x.n = v; return x.n }
row("freeze a record, then a typed store", () => { const t: Item = { id: 1, n: 1 }; Object.freeze(t); return set(t, 5) + " " + Object.isFrozen(t) });
row("freeze through any, then a typed store", () => { const t: Item = { id: 1, n: 1 }; hide(Object).freeze(hide(t)); return set(t, 5) + " " + Object.isFrozen(t) });
row("seal, then delete and add through any", () => { const t: Item = { id: 1, n: 1 }; Object.seal(t); const a = hide(t); let s = ""; try { delete a.n } catch (e) { s += "d" } try { a.z = 1 } catch (e) { s += "a" } return s + " " + Object.keys(t).join() + " " + Object.isSealed(t) });
row("preventExtensions, then an optional field", () => { const t: Item = { id: 1, n: 1 }; Object.preventExtensions(t); let s = ""; try { t.tag = "x" } catch (e) { s = (e as Error).name } return s + " " + t.tag + " " + Object.isExtensible(t) });
row("freeze an instance", () => { const p = new Point(); Object.freeze(p); let s = ""; try { p.x = 9 } catch (e) { s = (e as Error).name } return s + " " + p.sum() + " " + Object.isFrozen(p) });
row("freeze a class and its prototype", () => { Object.freeze(Point); Object.freeze(Point.prototype); return new Point().sum() + " " + Object.isFrozen(Point.prototype) });
row("a frozen array, a typed store and push", () => { const a: number[] = [1, 2]; Object.freeze(a); let s = ""; try { a[0] = 9 } catch (e) { s += (e as Error).name } try { a.push(3) } catch (e) { s += "+" + (e as Error).name } return s + " " + a.join() });
row("frozen plain data held to a type", () => { const r = Object.freeze(parse('{"id":1,"n":1}')); const t: Item = r; let s = ""; try { t.n = 5 } catch (e) { s = (e as Error).name } return s + " " + r.n + " " + ((t as unknown) === r) + " " + Object.isFrozen(t) });
