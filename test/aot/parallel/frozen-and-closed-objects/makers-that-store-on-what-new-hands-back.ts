// As in the TypeScript compiler: the constructors lie in variables that are filled later, and the makers add the properties.
function Sig(this: any, flags: number) { this.flags = flags; this.checker = undefined; }
function Returns(this: any, flags: number) { this.own = flags; return { replaced: flags }; }
function Freezes(this: any, flags: number) { this.flags = flags; Object.freeze(this); }
function Closes(this: any, flags: number) { this.flags = flags; Object.preventExtensions(this); }
class Links { declare brand: unknown; }
let sig: any, returns: any, freezes: any, closes: any, links: any, never: any;
let log = "";
function show(o: object): string { let inherited = ""; for (const name in o) inherited += name + " "; return Object.keys(o).join() + "|" + JSON.stringify(o) + "|" + inherited + log; }
function attempt(run: () => object): string { log = ""; try { return show(run()); } catch (e) { return (e instanceof TypeError ? "TypeError" : "other " + e) + log; } }

function makeSig(flags: number, d: unknown) { const s = new sig(flags); s.declaration = d; s.parameters = undefined; s.target = flags; s.flags = flags + 1; return s; }
function makeReturned(flags: number) { const s = new returns(flags); s.declaration = 1; s.own = 2; return s; }
function makeFrozen(flags: number) { const s = new freezes(flags); s.declaration = 1; return s; }
function makeClosed(flags: number) { const s = new closes(flags); s.flags = 5; s.declaration = 1; return s; }
function makeLinks(k: number) { const l = new links(); l.target = k; if (k & 1) l.mapper = undefined; l.checkFlags = k; return l; }
function makeNever() { const s = new never(1); s.declaration = 1; return s; }
function makeTwice(flags: number) { const a = new sig(flags), b = new sig(flags + 1); a.declaration = b; b.declaration = 1; a.target = 2; return a; }

console.log(attempt(() => makeSig(1, "early")));
sig = Sig; returns = Returns; freezes = Freezes; closes = Closes; links = Links;
for (let i = 0; i < 40; i++) { makeSig(i, i); makeReturned(i); makeLinks(i); makeTwice(i); }
console.log(attempt(() => makeSig(1, "d")), attempt(() => makeReturned(2)), attempt(() => makeFrozen(3)), attempt(() => makeClosed(4)));
console.log(attempt(() => makeLinks(0)), attempt(() => makeLinks(1)), attempt(makeNever), attempt(() => makeTwice(1)));
for (const descriptor of [{ set(v: unknown) { log += " set " + v; }, configurable: true }, { value: 8, writable: false, configurable: true }, { value: 9, writable: true, configurable: true, enumerable: true }]) {
  for (const name of ["declaration", "target", "flags"]) {
    Object.defineProperty(Sig.prototype, name, descriptor); Object.defineProperty(Links.prototype, name, descriptor);
    console.log(name, attempt(() => makeSig(1, "d")), attempt(() => makeLinks(1)), attempt(() => makeTwice(1)));
    delete Sig.prototype[name]; delete (Links.prototype as any)[name];
    console.log(name, attempt(() => makeSig(1, "d")), attempt(() => makeLinks(1)));
  }
}
Object.setPrototypeOf(Sig.prototype, { set parameters(v: unknown) { log += " parameters=" + v; } });
console.log(attempt(() => makeSig(1, "d")));
Sig.prototype = { marker: 1, set target(v: unknown) { log += " target=" + v; } };
console.log(attempt(() => makeSig(1, "d")));
