// One read, many kinds of receiver: some hold a function nobody has read yet in the field, some hold undefined or null there, some were made without it, and some have no such field at all:
// where the others keep it they keep something else, a number, a string, a reference, another function that is not made yet, or nothing because they are shorter.
const lines: string[] = [];
function say(...values: unknown[]) {
  lines.push(values.map(String).join(" "));
}
interface Hooks {
  a?: unknown;
  after?: (name: string) => string;
  before?: (name: string) => string;
}
class None implements Hooks {}
class Short implements Hooks {
  a = 1;
}
class Numbers implements Hooks {
  a = 0;
  b = 0;
  c = 0;
  d = 0;
  e = 0;
  f = 0;
}
class Others implements Hooks {
  a = "text";
  b = { inner: 1 };
  c = [1, 2, 3];
  d = 1.5;
  e = true;
  f = null;
}
class Both implements Hooks {
  after = (name: string) => "after " + name;
  before = (name: string) => "before " + name + this.tag;
  tag = "!";
}
class OnlyAfter implements Hooks {
  tag = "only";
  after = (name: string) => "only after " + name;
}
class OnlyBefore implements Hooks {
  before = (name: string) => "only before " + name + this.tag;
  tag = "?";
}
class Undefined implements Hooks {
  after = undefined;
  before = undefined;
}
class Late implements Hooks {
  after?: (name: string) => string;
  before?: (name: string) => string;
  arm() {
    this.after = name => "late after " + name;
    return this;
  }
}
function run(hooks: Hooks, name: string) {
  return [hooks.before?.(name), hooks.after?.(name), typeof hooks.after, typeof hooks.before, hooks.after === hooks.after, "after" in hooks].join(" | ");
}
function value(hooks: Hooks) {
  const after = hooks.after;
  const before = hooks.before;
  return (after ? after("v") : "no after") + " / " + (before === undefined ? "no before" : before("v"));
}
const makers: (() => Hooks)[] = [
  () => new None(),
  () => new Short(),
  () => new Numbers(),
  () => new Others(),
  () => new Both(),
  () => new OnlyAfter(),
  () => new Undefined(),
  () => new Late(),
  () => new Late().arm(),
  () => ({}),
  () => ({ after: name => "literal " + name }),
  () => ({ before: undefined, after: name => "literal with undefined " + name }),
  () => ({ x: 0, y: 0, z: 0, w: 0 }) as unknown as Hooks,
  // Where the others keep `after`, these keep another function that nobody has read yet.
  () => ({ before: name => "only before " + name }),
  () => ({
    before(name) {
      return "a method before " + name;
    },
  }),
  () => new OnlyBefore(),
];
for (let round = 0; round < 3; round++) {
  for (const make of makers) {
    const hooks = make();
    say(hooks.constructor.name, run(hooks, "r" + round), value(hooks));
  }
}
// Many of each, so that every kind is met where the code is warm, in every order.
let met = 0;
for (let i = 0; i < 4000; i++) {
  const hooks = makers[(i * 7) % makers.length]();
  if (hooks.after) met += hooks.after("x").length;
  if (hooks.before !== undefined) met += hooks.before("y").length;
}
say("met", met);

// No literal of this type is ever given `teardown`, so the literals have no room for it: where the instances of the class keep it, a literal keeps `setup`, which nobody has read yet.
interface Plugin {
  setup?(name: string): string;
  teardown?: (name: string) => string;
  weight?: number;
}
class Cleaner implements Plugin {
  teardown = (name: string) => "cleaned " + name;
  weight = 2;
}
class Idle implements Plugin {}
const starter: Plugin = {
  setup(name) {
    return "started " + name;
  },
};
function cycle(plugin: Plugin, name: string) {
  return [plugin.setup?.(name), plugin.teardown?.(name), plugin.weight, typeof plugin.teardown, "teardown" in plugin].join(" | ");
}
function stop(plugin: Plugin) {
  if (plugin.teardown) return plugin.teardown("stop");
  return plugin.setup !== undefined ? plugin.setup("instead") : "nothing";
}
const plugins: [string, Plugin][] = [
  ["idle", new Idle()],
  ["cleaner", new Cleaner()],
  ["starter", starter],
  ["empty", {}],
  ["another starter", { setup: name => "arrow " + name }],
];
for (let round = 0; round < 3; round++) {
  for (const [label, plugin] of plugins) say(label, cycle(plugin, "p" + round), stop(plugin));
}
console.log(lines.join("\n"));
