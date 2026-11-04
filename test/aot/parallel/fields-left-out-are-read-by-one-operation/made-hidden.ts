// `declare`: no field is defined where the object is made: the property is missing until somebody stores it.
class Links { flags = 0; declare type?: string; declare target?: Links; size() { return 1; } }
interface Options { name: string; limit?: number; label?: string }
// Each names itself: what may be entered again from below itself repeats what it writes, and there the reads get their typed form.
const again = Number(process.argv.length > 99);
function typeOf(l: Links): unknown { return again ? typeOf(l) : l.type; }
function truth(l: Links): unknown { return again ? truth(l) : l.type ? "there" : "not there"; }
function targetOf(l: Links): unknown { return again ? targetOf(l) : l.target; }
function three(l: Links): unknown { return again ? three(l) : [l.type, l.target === undefined, l.flags].join(); }
function limitOf(o: Options): unknown { return again ? limitOf(o) : o.limit; }
function labelOf(o: Options): unknown { return again ? labelOf(o) : o.label; }
function fill(l: Links) { l.type = "filled"; l.target = l; return l; }
// Each is called by value, so that each stands as a body of its own.
const readsOfLinks: ((l: Links) => unknown)[] = [typeOf, truth, targetOf, three];
const readsOfOptions: ((o: Options) => unknown)[] = [limitOf, labelOf];
function show(l: Links) { return JSON.stringify(readsOfLinks.map(read => { const found = read(l); return found instanceof Links ? "a Links" : String(found); })); }
function showOptions(o: Options) { return JSON.stringify(readsOfOptions.map(read => String(read(o)))); }
console.log(show(fill(new Links())));
const l = new Links(); console.log(show(l)); Object.defineProperty(l, "type", { value: "hidden", enumerable: false, writable: true, configurable: true });
for (let i = 0; i < 3; i++) console.log(show(l));
export {};
