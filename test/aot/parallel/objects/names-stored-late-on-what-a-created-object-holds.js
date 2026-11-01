// A function makes an object below a prototype and stores in it what it was handed. Other functions read that back and store names on it that its constructor never
// stored. What a program can ask about those names is asked: their order among the keys, `in`, descriptors, JSON, a name that only some objects get, a name removed and stored again.
function Message(id) {
  this.id = id;
  this.done = false;
}
Message.prototype.finish = function () {
  this.done = true;
  return this;
};
function Reply(id) {
  this.id = id;
  this.status = 200;
}
const base = {
  get label() {
    return `context ${this.message.id}`;
  },
};
function createContext(message, reply) {
  const context = Object.create(base);
  context.message = message;
  context.reply = reply;
  context.state = {};
  return context;
}
function attach(target, listener) {
  let attached = target.__attached;
  if (!attached) attached = target.__attached = [];
  attached.push(listener);
}
function parse(message) {
  const parsed = message._parsed;
  if (parsed !== undefined && parsed.id === message.id) return parsed;
  return (message._parsed = { id: message.id, text: `m${message.id}` });
}
function route(context, turn) {
  context.matched = [turn];
  if (turn % 2) context.route = `/r${turn}`;
  context.params = { turn };
}
function describe(object) {
  const lines = [];
  lines.push(Object.keys(object).join());
  lines.push(Reflect.ownKeys(object).map(String).join());
  const inLoop = [];
  for (const key in object) inLoop.push(key);
  lines.push(inLoop.join());
  lines.push(JSON.stringify(object, (key, value) => (typeof value === "function" ? "function" : value)));
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(object)))
    lines.push(
      `${key}: ${"value" in descriptor ? "value" : "accessor"} ${descriptor.writable} ${descriptor.enumerable} ${descriptor.configurable}`,
    );
  return lines;
}
function ask(object, names) {
  return names
    .map(
      name =>
        `${name} ${name in object} ${Object.hasOwn(object, name)} ${Object.prototype.hasOwnProperty.call(object, name)} ${object.propertyIsEnumerable(name)}`,
    )
    .join(" | ");
}
function attempt(action) {
  try {
    return action();
  } catch (error) {
    return error.constructor.name;
  }
}
// Whoever is handed an object by a function found under a computed name is out of sight.
const handlers = { first: handle, second: handleAgain };
const kept = [];
function handle(context, turn) {
  const reply = context.reply;
  attach(reply, () => turn);
  parse(context.message);
  route(context, turn);
  kept.push(context);
}
function handleAgain(context, turn) {
  const message = context.message;
  if (turn % 3 === 0) attach(message, () => -turn);
  parse(message);
  parse(message);
  route(context, turn);
  delete context.matched;
  context.matched = "again";
  kept.push(context);
}
const names = Object.keys(handlers);
for (let turn = 0; turn < 8; turn++) {
  const context = createContext(new Message(turn), new Reply(turn));
  globalThis[`seen${turn % 2}`] = context;
  handlers[names[turn % names.length]](globalThis[`seen${turn % 2}`], turn);
}
for (const context of kept) {
  console.log(context.label);
  for (const object of [context, context.message, context.reply]) {
    for (const line of describe(object)) console.log(" ", line);
    console.log(" ", ask(object, ["__attached", "_parsed", "matched", "route", "params", "id", "finish", "label"]));
  }
}
const last = kept[kept.length - 2];
// A name stored late is an ordinary property.
Object.defineProperty(last.reply, "__attached", { enumerable: false });
console.log(describe(last.reply).join("\n"));
Object.defineProperty(last.message, "_parsed", { get: () => "got", configurable: true });
console.log(last.message._parsed, describe(last.message).join("\n"));
console.log(
  attempt(() => parse(last.message)),
  last.message._parsed,
);
delete last.message._parsed;
console.log(
  ask(last.message, ["_parsed"]),
  parse(last.message).text,
  ask(last.message, ["_parsed"]),
  Object.keys(last.message).join(),
);
Object.freeze(last.reply);
attach(last.reply, () => 0);
console.log(last.reply.__attached.length, Object.isFrozen(last.reply));
const sealed = createContext(new Message(90), Object.preventExtensions(new Reply(90)));
console.log(attempt(() => attach(sealed.reply, () => 0)));
console.log(ask(sealed.reply, ["__attached"]), Object.keys(sealed.reply).join());
// A setter that comes to lie above the objects takes the stores from then on.
const before = new Reply(91);
attach(before, () => 0);
Object.defineProperty(Reply.prototype, "__attached", {
  set(value) {
    console.log("setter", this.id, Array.isArray(value));
  },
  get() {
    return undefined;
  },
  configurable: true,
});
const after = new Reply(92);
console.log(attempt(() => attach(after, () => 0)));
attach(before, () => 1);
console.log(
  before.__attached.length,
  ask(before, ["__attached"]),
  ask(after, ["__attached"]),
  Object.keys(after).join(),
);
console.log(
  { ...kept[1] }.route,
  Object.assign({}, kept[0]).route,
  Object.entries(kept[1].message).length,
  structuredClone(kept[1].message)._parsed.text,
);
