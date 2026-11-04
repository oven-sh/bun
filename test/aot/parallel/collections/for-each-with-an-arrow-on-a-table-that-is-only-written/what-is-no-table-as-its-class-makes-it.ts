// The receiver is written as a Map or a Set and nothing is proven of it: the functions are handed to unseen code. Each runs many times with what is written, and then with what is not.
import vm from "node:vm";
const unseen: any = (0, eval)("(x) => x");
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "string" ? part : JSON.stringify(part) ?? String(part)).join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \((evaluating|near|In) [\s\S]*$/, "")); } };
const log: string[] = []; const told = () => { const text = log.join(); log.length = 0; return text; };
function walk(members: Map<unknown, unknown>) { const seen: string[] = []; members.forEach((value, key) => { seen.push(String(key) + "=" + String(value)); }); return seen.join(); }
function walkSet(members: Set<unknown>) { const seen: string[] = []; members.forEach(value => { seen.push(String(value)); }); return seen.join(); }
const m: any = unseen(walk), s: any = unseen(walkSet);
for (let turn = 0; turn < 300; turn++) { m(new Map([[turn, turn]])); s(new Set([turn])); }
class Below extends Map<unknown, unknown> {}
class Own extends Map<unknown, unknown> { forEach(callback: any) { log.push("of the class"); callback("v", "k", this); } }
for (let turn = 0; turn < 3; turn++) {
  say(m(new Below([[1, 2]])), m(new Own([[1, 2]])), told());
  const onInstance: any = new Map([[1, 2]]); onInstance.forEach = function (callback: any) { log.push("on the instance"); callback("x", "y"); }; say(m(onInstance), told());
  const moved: any = new Map([[1, 2]]); Object.setPrototypeOf(moved, { forEach(callback: any) { log.push("another prototype"); callback(3, 4); } }); say(m(moved), told());
  const bare: any = new Map([[1, 2]]); Object.setPrototypeOf(bare, null); attempt("no prototype:", () => m(bare));
  say(m({ forEach(callback: any) { callback("b", "a"); } }), m([5, 6]), m(new Set([7])), s(new Map([[8, 9]])), s([1, 2]), m(Object.freeze(new Map([[1, 2]]))));
  say(m(vm.runInNewContext("new Map([[1, 2], [3, 4]])")), s(vm.runInNewContext("new Set([5, 6])")), m(vm.runInNewContext("new (class extends Map { forEach(f) { f(0, 0); } })()")));
  const proxy = new Proxy(new Map([[1, 2]]), { get(target, key) { log.push("get " + String(key)); const found = Reflect.get(target, key, target); return typeof found === "function" ? found.bind(target) : found; } }); say(m(proxy), told());
  attempt("a getter:", () => m({ get forEach() { log.push("getter"); return (callback: any) => callback(1, 1); } })); say(told());
  for (const odd of [undefined, null, 5, "text", true, {}, { forEach: 5 }]) attempt(String(JSON.stringify(odd)) + ":", () => m(odd));
  attempt("the method of Map on a Set:", () => Map.prototype.forEach.call(new Set([1]) as any, () => {}));
}
