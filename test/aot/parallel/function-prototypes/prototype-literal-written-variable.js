// The prototype object is a literal written through a variable.
function Emitter() {
  this.count = 0;
}
const members = (Emitter.prototype = {});
members.constructor = Emitter;
members.limit = 10;
members.on = function on() {
  return "on";
};
members.emit = function emit(type, ...rest) {
  this.count++;
  return "emit " + type + " " + rest.length;
};
Object.defineProperty(members, "size", {
  get() {
    return this.count * 2;
  },
  configurable: true,
});

function Stream() {
  Emitter.call(this);
}
const streamMembers = (Stream.prototype = { __proto__: members, constructor: Stream, pipe() { return "pipe+" + super.on(); }, get kind() { return "stream"; }, ["comp" + "uted"]: 1, ...{ spread: 2 } });

function First() {}
function Second() {}
const shared = (First.prototype = Second.prototype = {});
shared.run = function run() {
  return "shared run";
};

function use(object) {
  return [object.on(), object.emit("tick", 1, 2), object.limit, object.size, object.constructor.name].join(" ");
}
function useStream(stream) {
  return [use(stream), stream.pipe(), stream.kind, stream.computed, stream.spread].join(" ");
}
function hot() {
  let last = "";
  const emitter = new Emitter();
  const stream = new Stream();
  for (let i = 0; i < 3000; i++) last = use(emitter) + " | " + useStream(stream) + " | " + new First().run() + " " + new Second().run();
  return last;
}

console.log(hot());
console.log(Object.keys(members).join(), Object.keys(streamMembers).join(), JSON.stringify(streamMembers));
const inherited = [];
for (const name in new Stream()) inherited.push(name);
console.log(inherited.join());
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(members, "emit"), (key, value) => (typeof value === "function" ? value.name : value)));
console.log(Object.getPrototypeOf(new Emitter()) === members, Object.getPrototypeOf(members) === Object.prototype, new Stream() instanceof Emitter);

members.emit = function () {
  return "emit replaced";
};
console.log(hot());
streamMembers.emit = function () {
  return "emit added below";
};
console.log(hot());
delete streamMembers.emit;
delete members.on;
try {
  console.log(hot());
} catch (error) {
  console.log(error instanceof TypeError);
}
members.on = () => "on again";
members.limit = 20;
console.log(hot());
Object.defineProperty(members, "emit", { get() { return () => "emit from a getter"; }, configurable: true });
Object.defineProperty(members, "size", { value: "size is a value now", configurable: true });
console.log(hot());
shared.run = () => "shared run replaced";
console.log(hot());
Object.setPrototypeOf(members, { late() { return "late"; }, emit() { return "never seen"; } });
console.log(hot(), new Stream().late());

Object.defineProperty(members, "emit", { value() { return "emit is a value again"; }, writable: true, configurable: true });
const kept = new Emitter();
kept.emit = () => "own emit";
console.log(use(kept));
delete kept.emit;
console.log(use(kept));

const before = new Emitter();
Emitter.prototype = { emit() { return "emit of the second prototype object"; }, on() { return "second on"; }, limit: 1, size: 1 };
console.log(use(before).replace("Emitter", "same"), use(new Emitter()), new Emitter().constructor === Object);
console.log(hot());
