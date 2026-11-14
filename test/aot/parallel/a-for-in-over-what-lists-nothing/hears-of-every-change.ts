// A for-in over what lists nothing (`{}`, an instance of a class without fields, an object whose keys were all deleted, an empty list) ends at once, however often it is opened.
// It hears of every change all the same: a key of its own, a key laid above it, another prototype, a key that is hidden, a list that gets a member or a name.
// Where a key is laid on a prototype of the engine, that is either refused aloud or heard of.
const lines: string[] = [];
function names(o: any): string { let s = ""; for (const k in o) s += k + ";"; return s; }
function often(o: any): string { let all = ""; for (let turn = 0; turn < 4; turn++) all = names(o); return names(o) + "|" + all; }
class Empty {} class Heir extends Empty { x = 1; } class Below extends Empty {}
class Lazy { set(k: string, v: unknown): this { (this as any)[k] = v; return this; } }
const plain: any = {}, instance: any = new Empty(), below: any = new Below(), lazy: any = new Lazy().set("a", 1);
lines.push("nothing: " + [plain, instance, below].map(often).join(" "));
plain.late = 1; lines.push("a key of its own: " + often(plain)); delete plain.late; lines.push("gone again: " + often(plain));
(Empty.prototype as any).up = 1; lines.push("a key above: " + [instance, below, new Heir(), new Empty()].map(often).join(" ")); delete (Empty.prototype as any).up; lines.push("gone again: " + [instance, below].map(often).join(" "));
(Below.prototype as any).mid = 1; lines.push("a key between: " + [instance, below].map(often).join(" ")); delete (Below.prototype as any).mid;
delete lazy.a; lines.push("all deleted: " + often(lazy)); lazy.set("b", 2); lines.push("one again: " + often(lazy)); delete lazy.b; lines.push("all deleted again: " + often(lazy));
(Lazy.prototype as any).above = 1; lines.push("a key above what lost all: " + often(lazy)); delete (Lazy.prototype as any).above; lines.push("gone again: " + often(lazy));
lazy[7] = 1; lines.push("a numbered key on what lost all: " + often(lazy)); delete lazy[7]; lines.push("gone again: " + often(lazy));
const got: any = {}; often(got); Object.defineProperty(got, "got", { get() { return 1; }, enumerable: true, configurable: true }); lines.push("an accessor that is shown: " + often(got)); delete got.got; lines.push("gone again: " + often(got));
const marked: any = {}; often(marked); marked[Symbol("mark")] = 1; lines.push("a symbol lists nothing: " + often(marked)); marked.after = 1; lines.push("a key behind it: " + often(marked));
let listed: string[] = [];
const watcher = new Proxy({}, { ownKeys: () => listed, getOwnPropertyDescriptor: () => ({ value: 1, enumerable: true, configurable: true }) });
class UnderProxy {} Object.setPrototypeOf(UnderProxy.prototype, watcher);
const underProxy: any = new UnderProxy(), plainUnderProxy: any = Object.create(watcher), listUnderProxy: any[] = []; Object.setPrototypeOf(listUnderProxy, watcher);
lines.push("below a proxy that lists nothing: " + [underProxy, plainUnderProxy, listUnderProxy].map(often).join(" ")); listed = ["late"]; lines.push("which lists one now: " + [underProxy, plainUnderProxy, listUnderProxy].map(often).join(" ")); listed = []; lines.push("and nothing again: " + [underProxy, plainUnderProxy, listUnderProxy].map(often).join(" "));
const sealed: any = {}; often(sealed); Object.preventExtensions(sealed); lines.push("closed to new keys: " + often(sealed));
const moved: any = {}; often(moved); Object.setPrototypeOf(moved, { inherited: 1 }); lines.push("another prototype: " + often(moved)); Object.setPrototypeOf(moved, null); lines.push("none: " + often(moved));
const parent: any = {}, child: any = Object.create(parent); lines.push("below a plain object: " + often(child)); parent.given = 1; lines.push("which gets a key: " + often(child)); delete parent.given; lines.push("and loses it: " + often(child));
const hidden: any = {}; often(hidden); Object.defineProperty(hidden, "hidden", { value: 1, enumerable: false }); lines.push("a hidden key: " + often(hidden)); Object.defineProperty(hidden, "shown", { value: 1, enumerable: true }); lines.push("a shown key: " + often(hidden));
const numbered: any = {}; often(numbered); numbered[3] = 1; lines.push("a numbered key: " + often(numbered)); delete numbered[3]; lines.push("gone again: " + often(numbered));
let grown = ""; const grows: any = {}; for (const k in grows) grown += k; for (const k in (grows.a = 1, grows)) { grown += k; grows.b = 2; } lines.push("grown under the loop: " + grown);
lines.push("of many kinds: " + [{}, [], "", null, undefined, 5, () => 1, Object.create(null), Object.freeze({}), new Map(), new Set([1]), new Uint8Array(0), new Uint8Array(2)].map(often).join(" "));

const a: any[] = [], b: any[] = [1]; b.pop(); const c: any[] = [1.5]; c.length = 0; const d: any[] = ["x"]; d.shift();
lines.push("empty lists: " + [a, b, c, d, new Array(3), [,]].map(often).join(" "));
lines.push("beside lists with members: " + often([1]) + " " + often([]) + " " + often([, 1]) + " " + often([1.5, 2.5]) + " " + often([]));
a.push(5); lines.push("a member: " + often(a)); a.length = 0; lines.push("none again: " + often(a));
(b as any).extra = 1; lines.push("a name on a list: " + often(b)); delete (b as any).extra; lines.push("gone again: " + often(b));
class List extends Array { own = 1; } class Bare extends Array {}
lines.push("classes below Array: " + often(new List()) + " " + often(new Bare()));
(Bare.prototype as any).laid = 1; lines.push("a key above a bare one: " + often(new Bare())); delete (Bare.prototype as any).laid; lines.push("gone again: " + often(new Bare()));
const between: any = Object.create(Array.prototype), under: any[] = [], filled: any[] = [7]; Object.setPrototypeOf(under, between); Object.setPrototypeOf(filled, between);
lines.push("below a plain object below Array.prototype: " + often(under) + " " + often(filled)); between.laid = 1; lines.push("which gets a key: " + often(under) + " " + often(filled) + " " + often([])); delete between.laid; lines.push("and loses it: " + often(under) + " " + often(filled));
filled.pop(); lines.push("emptied there: " + often(filled)); between.again = 1; lines.push("a key again: " + often(filled) + " " + often(under)); delete between.again; lines.push("gone again: " + often(filled) + " " + often(under));
const listMoved: any[] = []; often(listMoved); Object.setPrototypeOf(listMoved, { up: 1, __proto__: Array.prototype }); lines.push("a list under another prototype: " + often(listMoved) + " " + often([]));
for (const [name, holder, subjects] of [["Object.prototype", Object.prototype, [{}, new Empty(), [], lazy]], ["Array.prototype", Array.prototype, [[], c, new Bare()]]] as [string, any, any[]][]) {
    subjects.forEach(often);
    let isLaid = true; try { holder.laidAbove = 1; } catch { isLaid = false; }
    const heard = subjects.every(subject => often(subject) === (isLaid ? "laidAbove;|laidAbove;" : "|"));
    if (isLaid) delete holder.laidAbove;
    lines.push("a key on " + name + ": " + (heard ? "refused aloud or heard of" : "LAID AND NOT HEARD OF") + " . behind it: " + subjects.map(often).join(" "));
}
for (const line of lines) console.log(line);
