// STATISTIC: AssignedMemberChecks >= 4
"use strict";
// Functions that nobody is seen to call read the accessors and call the methods of one class. What arrives is the class for the most part.
class Path {
  constructor(root) { this.stack = [root]; }
  get node() { return this.stack[this.stack.length - 1]; }
  get parent() { return this.ancestor(1); }
  get depth() { return this.stack.length; }
  ancestor(level) { let seen = -1; for (let i = this.stack.length - 1; i >= 0; i--) if (!Array.isArray(this.stack[i]) && ++seen === level) return this.stack[i]; return null; }
  descend(print, ...keys) {
    const length = this.stack.length; let value = this.node;
    for (const key of keys) { value = value[key]; this.stack.push(value); }
    try { return print(this); } finally { this.stack.length = length; }
  }
  each(print, key) { const all = []; for (let i = 0; i < this.node[key].length; i++) all.push(this.descend(print, key, i)); return all; }
}
const printers = {
  Program(path, print) { return path.each(print, "body").join(";"); },
  Call(path, print) { const { node, depth } = path; return `${path.descend(print, "callee")}(${node.list.length ? path.each(print, "list").join() : ""})@${depth}`; },
  Name(path) { const { node, parent } = path; return parent && parent.type === "Call" && parent.callee === node ? node.name.toUpperCase() : node.name; },
  Sum(path, print) { return path.descend(print, "left") + "+" + path.descend(print, "right") + (isNested(path) ? "!" : ""); },
};
function isNested(path) { return path.parent !== null && path.depth > 3; }
function print(path) { return printers[path.node.type](path, print); }
const name = (name) => ({ type: "Name", name }), call = (callee, ...list) => ({ type: "Call", callee, list }), sum = (left, right) => ({ type: "Sum", left, right });
const program = { type: "Program", body: [call(name("f"), name("a"), sum(name("b"), call(name("g")))), sum(sum(name("x"), name("y")), name("z"))] };
console.log(print(new Path(program)));
let total = 0;
for (let i = 0; i < 300; i++) total += print(new Path(program)).length;
console.log(total);

// Other objects under the same names.
const record = {}; record.node = name("r"); record.parent = null; record.depth = 9; record.descend = () => "record"; record.each = () => ["each"];
class Other { get node() { return call(name("o")); } get parent() { return { type: "Other" }; } get depth() { return 4; } descend(print) { return "other"; } }
class Heir extends Path { get depth() { return super.depth + 100; } get node() { const node = super.node; return node.type === "Name" ? name(node.name + "'") : node; } }
for (const it of [record, new Other, new Heir(program)]) { try { console.log(print(it)); } catch (e) { console.log(e.name); } }
const proxied = new Proxy(new Path(program), { get(target, key, receiver) { return key === "depth" ? 77 : Reflect.get(target, key, receiver); } });
console.log(print(proxied));
for (const value of [null, undefined, 5, "text", Symbol.iterator, [], {}, () => 1]) for (const printer of Object.values(printers)) { try { console.log(String(printer(value, print))); } catch (e) { console.log(e.name); } }

// Own properties in front of the accessors, accessors that change.
const shadowed = new Path(program);
Object.defineProperty(shadowed, "depth", { value: 55, configurable: true });
console.log(printers.Call(Object.assign(new Path(call(name("q"))), {}), print), (shadowed.stack = [call(name("s"))], print(shadowed)));
delete shadowed.depth; console.log(print(shadowed));
const frozen = Object.freeze(new Path(call(name("z"), name("w"))));
console.log(print(frozen));
const depth = Object.getOwnPropertyDescriptor(Path.prototype, "depth");
Object.defineProperty(Path.prototype, "depth", { get() { return -this.stack.length; }, configurable: true });
console.log(print(new Path(program)));
delete Path.prototype.depth; console.log(print(new Path(program)));
Object.defineProperty(Path.prototype, "depth", depth);
Path.prototype.descend = function (print, ...keys) { return `<${keys.join()}>`; };
console.log(print(new Path(program)));
const odd = new Path(program); Object.setPrototypeOf(odd, Other.prototype); console.log(print(odd));
console.log([1, 2, 3].map((i) => printers.Name(Object.create(Path.prototype, { stack: { value: [name("c" + i)] } }))).join());
