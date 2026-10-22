// The same parsed object is held by an annotated variable and passed as an argument: any object passes both, and the member it does not have reads undefined.
interface Meta { sign: string[] | true; secrets?: string }
function isSigned(meta: Meta): boolean { return !!meta.sign; }
function attempt(name: string, f: () => unknown): void { try { console.log(name, f()); } catch (e) { console.log(name, (e as Error).name); } }
const own: Meta = { sign: true };
const bag: unknown[] = [];
function load(text: string): any { bag.push(JSON.parse(text)); return bag.pop(); }
attempt("made by the program:", () => isSigned(own));
attempt("variable, then argument:", () => { const raw: any = load('{"path":"/"}'); const meta: Meta = raw; return [!!meta.sign, isSigned(raw)].join(); });
attempt("argument, then variable:", () => { const raw: any = load('{"path":"/"}'); const signed = isSigned(raw); const meta: Meta = raw; return [signed, !!meta.sign].join(); });
attempt("argument alone:", () => isSigned(load('{"path":"/"}')));
attempt("variable alone:", () => { const meta: Meta = load('{"path":"/"}'); return !!meta.sign; });
