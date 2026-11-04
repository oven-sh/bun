// One function calls what many makers make, so the call of the new closure is no call of one known function. It is made on every turn, behind the closure.
type Made = () => () => number;
function show(seen: unknown[]): string { let text = ""; for (let at = 0; at < seen.length; at++) text += (at ? "," : "") + String(seen[at]); return text; }
function readOne(thing: Made) { return thing()(); }
function together(n: number): string { const made: Made[] = []; for (let i = 0; i < n; i++) made.push(() => () => i); const seen: unknown[] = []; for (const thing of made) seen.push(readOne(thing)); return show(seen); }
function makes(n: number): Made[] { const made: Made[] = []; for (let i = 0; i < n; i++) made.push(() => () => i); return made; }
function reads(made: Made[]): string { const seen: unknown[] = []; for (const thing of made) seen.push(readOne(thing)); return show(seen); }
function extra0(n: number): string { const made: Made[] = []; for (let i = 0; i < n; i++) made.push(() => () => i); const seen: unknown[] = []; for (const thing of made) seen.push(readOne(thing)); return show(seen); }
console.log("extra0", extra0(3));
function extra1(n: number): string { const made: Made[] = []; for (let i = 0; i < n; i++) made.push(() => () => i); const seen: unknown[] = []; for (const thing of made) seen.push(readOne(thing)); return show(seen); }
console.log("extra1", extra1(3));
class Holder { n = 3; run(): string { const n = this.n; const made: Made[] = []; for (let i = 0; i < n; i++) made.push(() => () => i); const seen: unknown[] = []; for (const thing of made) seen.push(readOne(thing)); return show(seen); } }
console.log("method", new Holder().run());
{ const said = new Set<string>(); for (let turn = 0; turn < 200; turn++) said.add(together(3 + (turn % 2))); console.log("often", [...said].join(" | ")); }
{ const said = new Set<string>(); for (let turn = 0; turn < 200; turn++) said.add(reads(makes(3 + (turn % 2)))); console.log("often apart", [...said].join(" | ")); }
export {};
