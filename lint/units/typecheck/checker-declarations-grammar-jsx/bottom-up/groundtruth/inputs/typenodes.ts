type Tup = [a?: number, b: string, ...c: number[], ...d: string[]];
type Tup2 = [a: number?, ...b?: string[]];
type Cond<T> = T extends infer U ? U : never;
type BadInfer = infer X;
type Tmpl = `a${{ x: 1 }}`;
type Imp = import("./other", { with: { "resolution-mode": "bad" } }).readFile;
type Map1 = { [K in "a" | "b"]: K; extra: number };
type Map2 = { [K in symbol | boolean]: K };
type Idx = { a: 1 }["b"];
type TQ = typeof undefinedName;
type Uniq = unique string;
let ro: readonly number;
function tp<T = U, U = number, T>(this: void, x: T) {}
interface Dup { a: 1; a: 2; get b(): number; b: number }
class WithThis { m(): this is WithThis { return true; } }
function pred(...rest: any[]): rest is string[] { return true; }
function pred2({ a }: { a: any }): a is string { return true; }
type Alias<in out T> = T;
type string = 1;
type Intr = intrinsic;
type Ref = Array<number,>;
type Empty = Array<>;
