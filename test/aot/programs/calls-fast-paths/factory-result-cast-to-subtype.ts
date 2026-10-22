// Factory functions in the style of the TypeScript compiler: `new T(..)` on a predicted constructor, two calls deep, with the result cast to a subtype by the caller.
// IR= 1 createResolved : =?L[0-9]+ = (NewObject|CreateThis) 
// IR= 1 createTracedResolved : =?L[0-9]+ = (NewObject|CreateThis) 
// IR+  = Construct v[0-9]+ \(.*\).* isFallback
declare const console: any;
interface Ty { flags: number; id: number; checker: number; sym: string | undefined }
interface ObjectTy extends Ty { objectFlags: number; members: string | undefined }
interface Resolved extends ObjectTy { props: number }
function Ty(this: Ty, checker: number, flags: number) { this.flags = flags; this.checker = checker; this.id = 0; this.sym = undefined; }
interface Allocator { getTy(): new (checker: number, flags: number) => Ty }
const allocator: Allocator = { getTy: () => Ty as any };
let tracing: { record(t: Ty): void } | undefined;
function makeChecker() {
    var T = allocator.getTy();
    let count = 0;
    function createTy(flags: number): Ty { const result = new T(7, flags); count++; result.id = count; return result; }
    function createObject(objectFlags: number, sym: string): ObjectTy { const t = createTy(16) as ObjectTy; t.sym = sym; t.objectFlags = objectFlags; t.members = undefined; return t; }
    function resolve(t: ObjectTy, props: number): Resolved { const r = t as Resolved; r.props = props; return r; }
    function createResolved(sym: string, props: number): Resolved { return resolve(createObject(4, sym), props); }
    function createTracedTy(flags: number): Ty { const result = new T(7, flags); count++; result.id = count; tracing?.record(result); return result; }
    function createTracedObject(objectFlags: number, sym: string): ObjectTy { const t = createTracedTy(16) as ObjectTy; t.sym = sym; t.objectFlags = objectFlags; t.members = undefined; return t; }
    function createTracedResolved(sym: string, props: number): Resolved { return resolve(createTracedObject(4, sym), props); }
    return { createResolved, createTracedResolved };
}
const { createResolved: create, createTracedResolved: createTraced } = makeChecker();
let s = 0; let last: Resolved | undefined;
for (let i = 0; i < 2_000_000; i++) { const t = create("s", i & 7); s += t.flags + t.id + t.objectFlags + t.props; last = t; }
console.log(s, Object.keys(last!).join(), last instanceof (Ty as any));
for (let i = 0; i < 1000; i++) { const t = createTraced("t", i & 7); s += t.flags + t.id + t.objectFlags + t.props; last = t; }
const traced: string[] = []; tracing = { record(t) { traced.push(Object.keys(t).join()); } }; last = createTraced("u", 3);
console.log(s, Object.keys(last!).join(), traced.join(" "));
export {};
