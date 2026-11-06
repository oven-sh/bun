// f.apply(thisValue, rest) with a function nobody knows: the elements are copied to where arguments go, so the rest array may lie in the frame of whoever made it.
// Whatever f is, it never gets the array itself. The output is that of plain Bun.
const lines = [];
const show = (...values) => lines.push(values.map(value => (Array.isArray(value) ? "[" + value.join() + "]" : String(value))).join(" "));
const opaque = value => (lines.length < 0 ? null : value);

const kept = [];
function keepsArguments() {
  kept.push(arguments);
  arguments[0] = "changed";
  return arguments.length;
}
function keepsRest(...rest) {
  kept.push(rest);
  rest.push("pushed");
  return rest;
}
function returnsThis() {
  return [typeof this, this === undefined ? "undefined" : this.tag, arguments.length];
}
function throws(a) {
  throw new Error("thrown with " + a);
}
const targets = [
  keepsArguments,
  keepsRest,
  returnsThis,
  Math.max,
  String.fromCharCode,
  keepsRest.bind(null, "bound"),
  new Proxy(keepsRest, {}),
  new Proxy(keepsRest, { apply: (target, thisValue, list) => ["trapped", Array.isArray(list), list.length, list.push("by the trap")] }),
  Array.of,
  (...rest) => rest.length,
  class Constructor {},
  throws,
  null,
  "text",
];

function applies(f, receiver, ...args) {
  const result = f.apply(receiver, args);
  return [result, args.length, args.length ? args[0] : "none"];
}
function appliesInLoop(list, receiver, ...args) {
  const results = [];
  for (let i = 0; i < list.length; i++) {
    try {
      results.push(list[i].apply(receiver, args));
    } catch (error) {
      results.push(error.constructor.name);
    }
  }
  return [results.length, args];
}
function reflects(f, receiver, ...args) {
  return [Reflect.apply(f, receiver, args), args];
}

for (let round = 0; round < 3; round++) {
  for (let i = 0; i < targets.length; i++) {
    try {
      show(i, ...opaque(applies)(opaque(targets[i]), { tag: "receiver" + round }, 65 + round, 66, 67));
      show(i, ...opaque(applies)(opaque(targets[i]), undefined));
    } catch (error) {
      show(i, error.constructor.name);
    }
  }
  show("loop", ...opaque(appliesInLoop)(opaque(targets), { tag: "t" }, 70 + round, 71));
  show("reflect", ...opaque(reflects)(opaque(keepsRest), null, round, 72));
}
show("kept", kept.length, new Set(kept).size, kept.map(list => list.length).join());
console.log(lines.join("\n"));
