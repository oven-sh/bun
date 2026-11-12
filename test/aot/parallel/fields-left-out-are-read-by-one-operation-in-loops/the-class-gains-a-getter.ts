// `declare`: no field is defined where the object is made: the property is missing until somebody stores it.
class Links { flags = 0; declare type?: string; declare target?: Links; size() { return 1; } }
interface Options { name: string; limit?: number; label?: string }
// Each reads in a loop of its own, off what the turn has taken out of a list, behind a store that no turn may make twice: there a lone read is one operation.
let turns = 0;
function typeOf(held: Links[]): unknown { let found: unknown; for (let i = 0; i < held.length; i++) { turns++; found = held[i].type; } return found; }
function truth(held: Links[]): unknown { let found: unknown; for (let i = 0; i < held.length; i++) { turns++; found = held[i].type ? "there" : "not there"; } return found; }
function targetOf(held: Links[]): unknown { let found: unknown; for (let i = 0; i < held.length; i++) { turns++; found = held[i].target; } return found; }
function three(held: Links[]): unknown { let found: unknown; for (let i = 0; i < held.length; i++) { turns++; const l = held[i]; found = [l.type, l.target === undefined, l.flags].join(); } return found; }
function limitOf(held: Options[]): unknown { let found: unknown; for (let i = 0; i < held.length; i++) { turns++; found = held[i].limit; } return found; }
function labelOf(held: Options[]): unknown { let found: unknown; for (let i = 0; i < held.length; i++) { turns++; found = held[i].label; } return found; }
function fill(l: Links) { l.type = "filled"; l.target = l; return l; }
// Each is called by value, so that each stands as a body of its own.
const readsOfLinks: ((held: Links[]) => unknown)[] = [typeOf, truth, targetOf, three];
const readsOfOptions: ((held: Options[]) => unknown)[] = [limitOf, labelOf];
function show(l: Links) { return JSON.stringify(readsOfLinks.map(read => { const found = read([l]); return found instanceof Links ? "a Links" : String(found); })); }
function showOptions(o: Options) { return JSON.stringify(readsOfOptions.map(read => String(read([o])))); }
console.log(show(fill(new Links())));
const l = new Links(); console.log(show(l)); Object.defineProperty(Links.prototype, "type", { get() { return "getter of the class"; }, configurable: true });
for (let i = 0; i < 3; i++) console.log(show(l));
console.log(turns);
export {};
