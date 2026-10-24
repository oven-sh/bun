// A value that is outside the type of a parameter arrives through `any` or a cast. The entrance tests it, whichever passes a build leaves out.
function twice(x: number): number { return x * 2; }
const anyTwice: any = twice;
console.log(anyTwice("21"), anyTwice({ valueOf() { return 4; } }), anyTwice(undefined));
function nameOf(p: { name: string }) { return p.name; }
console.log((nameOf as any)({ name: 5 }), (nameOf as any)(new Map()), (nameOf as any)("text"));
interface Startable { method(): number }
function start(typed: Startable): number { return typed.method(); }
const odd = Object.create({ method() { return 7; } }) as Startable;
console.log(start({ method() { return 1; } }), start(odd), start(new (class { method() { return 9; } })()));
