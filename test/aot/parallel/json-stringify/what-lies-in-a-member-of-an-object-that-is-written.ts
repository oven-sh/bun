// JSON.stringify writes an object that is a member of another in the same breath where all is known of it. Each line varies what the member is, what it holds, who may answer for it, and how deep it lies.
import vm from "node:vm";
const said: string[] = [];
const say = (name: string, make: () => unknown, ...rest: [unknown?, unknown?]) => {
  let answer: string;
  try { answer = String(JSON.stringify(make(), rest[0] as any, rest[1] as any)); } catch (error) { answer = (error as Error).name + ": " + (error as Error).message.slice(0, 40); }
  said.push(name + " " + (answer.length > 300 ? answer.length + ":" + answer.slice(0, 60) + ".." + answer.slice(-60) : answer));
};
class Point { constructor(public x: number, public y: number) {} }
class Named extends Point { name = "n"; toJSON() { return this.name + this.x; } }
class Late extends Point {}
const owner = { id: 1, name: "owner" };
say("a member", () => ({ id: 7, owner, done: true }));
say("the same member twice", () => ({ first: owner, second: owner }));
say("members of four layouts", () => ({ a: { b: { c: { d: 1 } } }, e: { f: 2 }, g: {} }));
say("two layouts in turn", () => [1, 2, 3, 4].map((id) => ({ id, owner: { id, boss: { id: id + 1, owner: { id, boss: null } } } })));
say("an instance of a class", () => ({ at: new Point(1, 2.5), to: new Point(-0, 1e21) }));
say("toJSON of the class", () => ({ at: new Named(1, 2), beside: new Point(3, 4) }));
say("toJSON of its own", () => ({ by: { toJSON() { return "someone"; } }, beside: owner }));
say("toJSON that is no function", () => ({ by: { toJSON: 5, x: 1 } }));
say("toJSON laid on later", () => { const member: any = { x: 1 }; const holder = { member }; const before = JSON.stringify(holder); member.toJSON = () => "late"; return [before, holder]; });
say("toJSON laid on the prototype later", () => { const holder = { at: new Late(1, 2) }; const before = JSON.stringify(holder); (Late.prototype as any).toJSON = function () { return "late " + this.x; }; return [before, holder, { at: new Late(3, 4) }]; });
say("a property laid on later", () => { const member: any = { x: 1 }; member["added at " + member.x] = [1, { y: 2 }]; return { member, beside: { x: 2 } }; });
say("a property taken away", () => { const member: any = { x: 1, y: 2, z: 3 }; delete member.y; return { member, beside: { x: 4, y: 5, z: 6 } }; });
say("a getter", () => ({ member: { get x() { said.push("x is read"); return 1; }, y: 2 } }));
say("a getter defined later", () => { const member = { x: 1, y: 2 }; Object.defineProperty(member, "x", { get() { return "got"; }, enumerable: true }); return { member }; });
say("a property that is not listed", () => { const member = { x: 1, y: 2 }; Object.defineProperty(member, "y", { enumerable: false }); return { member }; });
say("what is left out", () => ({ member: { a: undefined, b: () => 1, c: Symbol("s"), d: null, e: NaN, f: -Infinity, [Symbol("k")]: 1 }, list: [undefined, () => 1, Symbol("s")] }));
say("texts", () => ({ member: { plain: "abc", quoted: "a\"b\\c\n", wide: "中文", lone: "\ud800", joined: "left" + said.length + "right", long: "x".repeat(200) } }));
say("a wide text deep inside", () => ({ a: { b: { c: { d: "é中" }, e: "plain" } } }));
say("keys that need quotes", () => ({ member: { "a\"b": 1, "中": 2, "": 3, 5: 4 } }));
say("a bigint", () => ({ member: { big: 1n } }));
say("boxed ones", () => ({ member: { n: new Number(1), s: new String("s"), b: new Boolean(false) } }));
say("lists, maps and sets", () => ({ member: { list: [1, [2, { x: 3 }]], map: new Map([[1, 2]]), set: new Set([1]), typed: new Uint8Array(2) } }));
say("a proxy", () => ({ member: new Proxy({ x: 1 }, {}) }));
say("no prototype", () => ({ member: Object.assign(Object.create(null), { x: 1 }) }));
say("frozen and sealed", () => ({ frozen: Object.freeze({ x: 1 }), sealed: Object.seal({ y: 2 }) }));
say("itself inside", () => { const member: any = { x: 1 }; member.self = { back: member }; return { member }; });
say("its holder inside", () => { const holder: any = { member: { x: 1 } }; holder.member.up = holder; return holder; });
say("forty levels", () => { let chain: any = null; for (let level = 0; level < 40; level++) chain = { level, chain }; return chain; });
say("three thousand levels", () => { let chain: any = null; for (let level = 0; level < 3000; level++) chain = { level, chain }; return chain; });
say("three hundred thousand levels", () => { let chain: any = null; for (let level = 0; level < 300000; level++) chain = { level, chain }; return chain; });
say("more than the first buffer", () => ({ rows: Array.from({ length: 400 }, (_, id) => ({ id, owner: { id, name: "owner " + id }, tags: ["a", "b"] })) }));
say("with a gap", () => ({ id: 7, owner, at: new Date(0) }), null, 2);
say("with a list of keys", () => ({ id: 7, owner, name: "holder" }), ["owner", "name"]);
say("with a function", () => ({ id: 7, owner }), (key: string, value: unknown) => (key === "id" ? undefined : value));
say("dates", () => ({ at: new Date(86400000), never: new Date(NaN), far: new Date(8.64e15), early: new Date(-1), member: { at: new Date(0) } }));
say("a date with toJSON of its own", () => { const at: any = new Date(0); at.toJSON = () => "mine"; return { at, beside: new Date(1) }; });
say("a date with toISOString of its own", () => { const at: any = new Date(0); at.toISOString = () => "mine"; return { at, beside: new Date(1) }; });
say("a date of a class below Date", () => { class Day extends Date { toJSON() { return "day"; } } class Plain extends Date {} return { day: new Day(0), plain: new Plain(0), beside: new Date(2) }; });
say("a date with another prototype", () => { const at = new Date(0); Object.setPrototypeOf(at, { toJSON() { return "other"; } }); return { at, beside: new Date(3) }; });
say("a date of another realm", () => ({ there: vm.runInNewContext("new Date(5)"), here: new Date(6), thereAgain: vm.runInNewContext("({ at: new Date(7), member: { x: 1 } })") }));
say("dates again behind all that", () => [new Date(8), { at: new Date(9) }]);
let length = 0;
const page = { total: 20, tasks: Array.from({ length: 20 }, (_, id) => ({ id, title: "task " + id, owner: { id: id % 5, name: "owner" }, at: new Date(86400000 * id) })) };
for (let round = 0; round < 2000; round++) length += JSON.stringify(page).length;
said.push(String(length));
console.log(said.join("\n"));
