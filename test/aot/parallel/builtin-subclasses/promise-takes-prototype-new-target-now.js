// Promise is constructed again and again for one new.target: a class below it, a class below that, a plain function whose `prototype` the program exchanges between two constructions,
// a function that is new.target for Map as well, a bound function, a proxy. Each promise has the prototype that new.target holds at that moment.
class Task extends Promise { label() { return "task"; } }
class Job extends Task { constructor(executor) { super(executor); this.started = true; } }
function Plain() { }
const first = Object.create(Promise.prototype, { label: { value: () => "first" } });
const second = Object.create(Promise.prototype, { label: { value: () => "second" } });
const executor = resolve => resolve(1);
const make = (C, turns) => { let made; for (let i = 0; i < turns; i++) made = new C(executor); return made; };
const construct = (target, turns) => { let made; for (let i = 0; i < turns; i++) made = Reflect.construct(Promise, [executor], target); return made; };
const lines = [];
const show = (what, made, prototype) => lines.push(what + ": " + (Object.getPrototypeOf(made) === prototype) + " " + (made instanceof Promise) + " " + (typeof made.label === "function" ? made.label() : "-") + " " + Object.keys(made).join());
show("Promise", make(Promise, 50), Promise.prototype);
show("Task", make(Task, 50), Task.prototype);
show("Job", make(Job, 50), Job.prototype);
show("Task for Promise", construct(Task, 50), Task.prototype);
Plain.prototype = first;
show("Plain, first", construct(Plain, 50), first);
Plain.prototype = second;
show("Plain, second", construct(Plain, 50), second);
Plain.prototype = 7;
show("Plain, no object", construct(Plain, 50), Promise.prototype);
Plain.prototype = first;
for (let i = 0; i < 20; i++) {
  const map = Reflect.construct(Map, [], Plain);
  const promise = construct(Plain, 1);
  if (Object.getPrototypeOf(map) !== first || Object.getPrototypeOf(promise) !== first || !Map.prototype.has.call(Map.prototype.set.call(map, 1, 2), 1)) throw new Error("turn " + i);
  Promise.prototype.then.call(promise, () => { });
}
show("Plain beside Map", construct(Plain, 3), first);
show("bound", construct(Task.bind(null), 50), Task.prototype);
show("proxy", construct(new Proxy(Job, {}), 50), Job.prototype);
let reads = 0;
const counting = new Proxy(Task, { get(target, key, receiver) { if (key === "prototype") reads++; return Reflect.get(target, key, receiver); } });
construct(counting, 5);
lines.push("prototype read " + reads + " times");
if (typeof Bun !== "undefined") Bun.gc(true);
show("Task behind a collection", make(Task, 50), Task.prototype);
for (const bad of [undefined, 1, {}, () => { }]) { try { Reflect.construct(Promise, [executor], bad); lines.push("made"); } catch (error) { lines.push(error.constructor.name); } }
try { new Task(); } catch (error) { lines.push(error.constructor.name + ": " + error.message); }
lines.push(String(make(Task, 3).then(() => { }) instanceof Task), String(Task.resolve(1) instanceof Task), String(Job.all([]) instanceof Job));
make(Job, 2000).then(value => { lines.push("fulfilled with " + value); console.log(lines.join("\n")); });
