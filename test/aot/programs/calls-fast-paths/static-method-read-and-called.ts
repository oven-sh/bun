// `A.twice(n)`: the static method is read before the arguments are evaluated, so an argument that replaces the method does not change what is called.
// IR= 1 declared  = Call v
// IR= 1 declared  = IsClassUnmodified 
// IR= 1 declared  = PropGet v[0-9]+ name="twice"
// IR= 1 inherited  = Call v
// IR= 1 looksAtThis  = Call v
// IR= 1 constants  = Call v
// IR= 2 seen  = Call v
declare const console: any;
class A { static twice(n: number): number { return n + n } static other(n: number): number { return n } static scale = 3; static scaled(n: number): number { return n * this.scale } static pair(a: number, b: string): string { return b + a } }
class B { static twice(n: number): number { return n + n } static other(n: number): number { return n } }
class C { static twice(n: number): number { return n + n } static other(n: number): number { return n } }
class D { static twice(n: number): number { return n + n } }
class Heir extends A { }
class G { static get made(): (n: number) => number { return n => n + 100 } }
const put: ((o: any, name: string, value: unknown) => void)[] = [(o, name, value) => { o[name] = value }];
export function declared(n: number): number { return A.twice(n) }
export function otherReplaced(n: number): number { return B.twice(n) }
export function itselfReplaced(n: number): number { return C.twice(n) }
export function inherited(n: number): number { return Heir.twice(n) }
export function looksAtThis(n: number): number { return A.scaled(n) }
export function constants(): string { return A.pair(4, "x") }
function replaces(n: number): number { put[0](D, "twice", (m: number) => m + 1000); return n }
export function seen(n: number): number { return D.twice(replaces(n)) }
export function kept(n: number): number { const f = A.twice; return f(n) + f(n + 1) }
export function accessor(n: number): number { return G.made(n) }
export function caught(n: number): string { try { return "" + C.twice(n) } catch (e) { return "caught " + (e as Error).name } }
console.log("as declared", declared(4), otherReplaced(4), itselfReplaced(4), inherited(4), looksAtThis(4), constants(), kept(4), accessor(4), caught(4));
put[0](B, "other", (n: number) => n + 1); put[0](C, "twice", (n: number) => n + n + 1);
console.log("replaced", declared(4), otherReplaced(4), itselfReplaced(4), inherited(4), caught(4));
console.log("seen", seen(4), seen(4));
put[0](C, "twice", 5);
console.log("no function", caught(4));
put[0](C, "twice", () => { throw new RangeError("thrown") });
console.log("throws", caught(4));
put[0](A, "scale", 5); console.log("this", looksAtThis(4));
let sum = 0; for (let i = 0; i < 1000; i++) sum += declared(i) + otherReplaced(i) + itselfReplacedSafely(i) + inherited(i); console.log("sum", sum);
function itselfReplacedSafely(n: number): number { try { return C.twice(n) } catch { return 1 } }
