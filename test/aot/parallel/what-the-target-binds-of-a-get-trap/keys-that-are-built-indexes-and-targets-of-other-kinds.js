// Keys that are put together at run time, keys that are indexes, and targets that answer for their members in ways of their own.
const mark = Symbol("mark");
const handler = { get: () => "a lie" };
function attempt(read) {
  try {
    return String(read());
  } catch (error) {
    return error.constructor.name;
  }
}
function marked(target) {
  Object.defineProperty(target, mark, { value: 1 });
  return target;
}
const halves = ["fi", "xed"];
const holder = marked({ free: 1 });
Object.defineProperty(holder, "fixed", { value: 2 });
Object.defineProperty(holder, "0", { value: 3 });
Object.defineProperty(holder, "1", { value: 4, configurable: true });
const proxy = new Proxy(holder, handler);
for (let turn = 0; turn < 3; turn++) {
  console.log(
    attempt(() => proxy[halves[0] + halves[1]]),
    attempt(() => proxy[halves.join("")]),
    attempt(() => proxy["fr" + "ee".slice(turn - turn)]),
    attempt(() => proxy[0]),
    attempt(() => proxy["0"]),
    attempt(() => proxy[1]),
    attempt(() => proxy[2]),
  );
}
const others = {
  list: [marked([1, 2]), ["length", "map", "0"]],
  frozenList: [Object.freeze([1, 2]), ["length", "0", "5"]],
  ordinaryFunction: [
    marked(function named() {}),
    ["prototype", "name", "length", "absent"],
  ],
  arrow: [marked(() => 1), ["name", "length", "prototype"]],
  classItself: [marked(class Named {}), ["prototype", "name"]],
  text: [marked(new String("ab")), ["length", "0", "absent"]],
  pattern: [marked(/a/g), ["lastIndex", "source"]],
  proxyOfProxy: [new Proxy(holder, {}), ["fixed", "free", "absent"]],
  namespaceLike: [marked(Math), ["PI", "abs", "absent"]],
};
for (const [kind, [target, names]] of Object.entries(others)) {
  const outer = new Proxy(target, handler);
  for (let turn = 0; turn < 2; turn++)
    console.log(
      kind,
      names.map((name) => attempt(() => outer[name])).join(" "),
    );
  console.log(
    kind,
    attempt(() => outer.length),
    attempt(() => outer.prototype),
    attempt(() => outer.name),
    attempt(() => outer.PI),
    attempt(() => outer.fixed),
    attempt(() => outer.lastIndex),
  );
}
