// Reads `x[i]` where i is a negative integer and x has no type: `list[list.length - 1]` of an empty array, `list[i - 1]` at the start; arrays of every make, arrays that do have such a property, or inherit one, and what is no array.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lines = [];
function say(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part) ?? String(part))).join(" "));
}
function last(list) { return list[list.length - 1]; }
function before(list, i) { return list[i - 1]; }
function at(list, i) { return list[i]; }
const table = { last, before, at };
function three(list) { return [table.last(list), table.before(list, 0), table.at(list, -2), table.at(list, -2147483648)]; }

for (let i = 0; i < 60; ++i) {
  table.last([]);
  table.before([i], 0);
  table.at([i, i + 0.5], -1 - (i % 3));
}
say("empty", three([]));
say("integers", three([1, 2, 3]), table.before([1, 2, 3], 1));
say("doubles", three([1.5, 2.5]), table.before([1.5, 2.5], 2));
say("anything", three(["a", {}, 3]), table.last(["a", "b"]));
{
  const pushed = [];
  say("before a push", table.last(pushed));
  pushed.push(7);
  say("behind it", table.last(pushed), table.before(pushed, 0));
  pushed.pop();
  say("behind a pop", table.last(pushed));
}
say("made by built-ins", three(new Array()), three(new Array(3)), three(Array.from([])), three([1, 2].slice(2)), three("a,b".split(",")), three(Object.keys({})), three(JSON.parse("[]")));
say("holes", three([, 1]), three([1, , 3]));
{
  const own = [1, 2];
  own[-1] = "own";
  say("a property of its own", three(own), Object.keys(own).join());
  delete own[-1];
  say("deleted again", three(own), Object.keys(own).join());
  const named = [1, 2];
  named.label = "named";
  say("another property of its own", three(named));
  named["-2"] = "minus two";
  say("and one at -2", three(named));
  const accessor = [1];
  Object.defineProperty(accessor, "-1", { get() { return "got " + this.length; } });
  say("an accessor of its own", three(accessor));
}
{
  const above = { "-1": "inherited", "-2": "inherited too" };
  const moved = Object.setPrototypeOf([1, 2], above);
  say("another prototype", three(moved), Array.isArray(moved));
  const bare = Object.setPrototypeOf([1, 2], null);
  say("no prototype", table.before(bare, 0), table.at(bare, -2));
  class Stack extends Array {
    get [-1]() { return "from the class"; }
  }
  say("a derived array", three(Stack.from([1, 2])), three(new Stack()));
  class Plain extends Array {}
  say("a derived array that adds nothing", three(Plain.from([1, 2])), three(new Plain()));
  const inheriting = Object.create([1, 2, 3]);
  say("an object whose prototype is an array", table.before(inheriting, 0), table.at(inheriting, 1), table.last(inheriting));
  const trapped = new Proxy([1, 2], { get(target, key) { return typeof key === "string" && key[0] === "-" ? "trapped " + key : target[key]; } });
  say("a proxy", three(trapped));
  const behindProxy = Object.setPrototypeOf([1], new Proxy({}, { get(target, key) { return "from the proxy " + String(key); } }));
  say("a proxy for a prototype", table.before(behindProxy, 0), table.at(behindProxy, 5));
}
say("frozen", three(Object.freeze([1, 2])), three(Object.seal([1])), three(Object.preventExtensions([])));
{
  const sparse = [];
  sparse[100000] = 1;
  say("sparse", table.before(sparse, 0), table.at(sparse, -2));
}
say("no arrays", table.at("text", -1), table.last(""), table.at(new Uint8Array(2), -1), table.at({ "-1": "of an object" }, -1), table.at({}, -1), table.at(5, -1), table.at(function () {}, -1), table.at(new Map(), -1));
(function () { say("arguments", table.at(arguments, -1), table.last(arguments)); })(1, 2);
for (const nothing of [undefined, null]) {
  try {
    say(table.at(nothing, -1));
  } catch (error) {
    say("of " + nothing, error.constructor.name);
  }
}
say("other keys", table.at([1, 2], -0), table.at([1, 2], -1.5), table.at([1, 2], "-1"), table.at([1, 2], -Infinity), table.at([1, 2], NaN));
{
  let seen = 0;
  const kept = [1, 2, 3];
  const before0 = count("operationAOTGetByVal");
  for (let i = 0; i < 3000; ++i) {
    if (table.last([]) === undefined) ++seen;
    if (table.before(kept, 0) === undefined) ++seen;
    if (table.before([i + 0.5], 0) === undefined) ++seen;
    if (table.at(["a", i], -3) === undefined) ++seen;
  }
  const asked = count("operationAOTGetByVal") - before0;
  say("rounds", seen);
  say(asked <= 200 ? "the reads asked the run time at most 200 times" : "the reads asked the run time " + asked + " times");
}
console.log(lines.join("\n"));
