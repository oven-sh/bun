// read-in-a-loop, getter-laid-on-the-prototype-of-the-base: some members of what is written have the name `locals` and some lack it.
function show(v: any): string { return Object.is(v, -0) ? "-0" : typeof v + " " + String(v); }
function tried(run: () => any): string { try { return show(run()); } catch (e: any) { return "threw " + e.constructor.name; } }
class Part { kind = 0; }
class Leaf extends Part { text = "leaf"; }
class Scope extends Part { locals: any = "scope"; }
class Block extends Part { text = "block"; depth = 1; locals: any = "block"; }
class Loop extends Part { depth = 2; locals: any; }
class Empty extends Part { }
function make(): Part[] { return [new Leaf(), new Scope(), new Block(), new Loop(), new Empty(), new Part(), new Scope(), new Block()]; }
function each(list: Part[]): string { let text = ""; for (let i = 0; i < list.length; i++) { const part = list[i]; text += show((part as Scope).locals) + ";"; } return text; }
for (let round = 0; round < 3; round++) console.log(each(make()));
const list = make();
Object.defineProperty(Part.prototype, "locals", { get() { return "got " + this.kind; }, set(v) { this.kind = 9; }, configurable: true });
console.log(tried(() => each(list)));
console.log(tried(() => each(list)));
console.log(each(make()));
console.log(tried(() => each([undefined as any])), tried(() => each([null as any])));
