// `const r = new T(..); r.id = ..; r.sym = ..` where the constructor is only predicted.
// IR= 2 make PropSet v[0-9]+, v[0-9]+ name="sym"
// IR= 2 make PropSet v[0-9]+, v[0-9]+ name="extra"
// IR= 2 makeCounted PropSet v[0-9]+, v[0-9]+ name="id"
// IR= 2 makeCounted PutEnvironmentField
// IR= 1 makeSeen PropSet v[0-9]+, v[0-9]+ name="id"
declare const console: any;
interface Ty { flags: number; id: number; sym: string | undefined; extra: number }
function Ty(this: Ty, flags: number) { this.flags = flags; }
interface Allocator { getTy(): new (flags: number) => Ty }
const allocator: Allocator = { getTy: () => Ty as any };
function makeChecker() {
    var T = allocator.getTy();
    let count = 0;
    function make(flags: number, sym: string): Ty { const result = new T(flags); result.sym = sym; result.extra = 7; result.id = 0; return result; }
    function makeCounted(flags: number): Ty { const result = new T(flags); count++; result.id = count; return result; }
    function makeSeen(flags: number): Ty { const result = new T(flags); seen.push(result); result.id = 5; return result; }
    return { make, makeCounted, makeSeen };
}
const seen: Ty[] = [];
const { make, makeCounted, makeSeen } = makeChecker();
let s = 0; let last: Ty | undefined;
for (let i = 0; i < 3_000_000; i++) { const t = make(i & 15, "s"); s += t.flags + t.extra + t.id; last = t; }
console.log(s, Object.keys(last!).join(), JSON.stringify(last), last instanceof (Ty as any));
for (let i = 0; i < 3_000_000; i++) { const t = makeCounted(i & 15); s += t.flags + t.id; last = t; }
console.log(s, Object.keys(last!).join(), JSON.stringify(last));
for (let i = 0; i < 10; i++) s += makeSeen(i).id;
console.log(s, seen.length, Object.keys(seen[9]).join());
export {};
