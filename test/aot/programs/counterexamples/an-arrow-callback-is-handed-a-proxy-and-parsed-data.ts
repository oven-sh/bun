// An arrow function with a typed parameter is called through `any` with a Proxy and with parsed JSON.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
interface Ev { n: number }
class Em { fs: ((e: any) => void)[] = []; on(f: (e: any) => void) { this.fs.push(f) } emit(e: unknown) { for (const f of this.fs) f(e) } }
class Us { seen = 0; constructor(em: Em) { em.on((e: Ev) => this.handle(e)) } handle(e: Ev) { this.seen += e.n } }
row("an arrow callback with this is handed a Proxy", () => { const em = new Em(); const u = new Us(em); em.emit(new Proxy({ n: 2 }, {})); em.emit(JSON.parse('{"n":3}')); return u.seen });
