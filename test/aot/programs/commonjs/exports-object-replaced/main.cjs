// A module may replace module.exports before, between or after its stores, by a name the compiler sees or by one it does not, and other code may replace it again later: require() answers what module.exports holds at that moment, `exports` keeps the first object, and code that names the module and the member works on whatever arrives.
// `this` at the top of a CommonJS file is the receiver of the call of its body: the object that `exports` held at first. A store to the variable `exports` does not change it, as in Node. Plain Bun writes `exports` in the place of that `this`, so the lines that read `this` behind such a store are stored.
const { describe, show } = require("../describe-object.cjs");

function report(name, value) {
  if (typeof value === "object" && value !== null) describe(name, value);
  else console.log(`${name}:`, show(value), typeof value === "function" ? Object.keys(value).join() : "");
  const first = globalThis.firstExports;
  console.log("  first object", first === value, Object.keys(first).join());
  return first;
}

function attempt(label, action) {
  try {
    console.log(label, show(action()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

const before = require("./before-stores.cjs");
report("before-stores", before);
console.log("  members", before.literal, before.added, before.onFirst);

const after = require("./after-stores.cjs");
report("after-stores", after);
console.log("  members", after.a, after.b, after.name);

const between = require("./between-stores.cjs");
report("between-stores", between);
console.log("  members", between.a, between.b, between.c, between.d, between.e);

const both = require("./both-variables.cjs");
report("both-variables", both);
console.log("  members", both.a, both.b, both.name);

const computed = require("./by-computed-name.cjs");
const firstOfComputed = report("by-computed-name", computed);
console.log("  members", computed.a, computed.b, computed.c, computed.computed);
computed.a = "stored by main";
console.log("  after a store", Object.keys(computed).join(), computed.a, firstOfComputed.a);

const other = require("./by-other-code.cjs");
const firstOfOther = report("by-other-code", other);
console.log("  members", other.a, other.b, other.c, other.replacedBy, other.had);
other.b = "stored by main";
console.log("  after a store", Object.keys(other).join(), other.b, firstOfOther.b);
const { a, b, c, had } = require("./by-other-code.cjs");
console.log("  destructured", a, b, c, had);

const same = require("./with-the-same-object.cjs");
report("with-the-same-object", same);
console.log("  members", same.a, same.b, same.c, same.tell());

const primitive = require("./with-a-primitive.cjs");
const firstOfPrimitive = report("with-a-primitive", primitive);
console.log("  members", primitive.a, primitive.b, primitive.c, primitive.toFixed(1));
primitive.a = "stored by main";
console.log("  after a store", primitive.a, firstOfPrimitive.a);

const conditional = require("./conditionally.cjs");
report("conditionally", conditional);
console.log("  members", conditional.a, conditional.b, conditional.never);

const assigned = require("./exports-variable-assigned.cjs");
report("exports-variable-assigned", assigned);
console.log("  members", assigned.a, assigned.b, assigned.c, assigned.local);

const owner = globalThis.moduleOfTheSameObject;
for (const replacement of [42, "text", null, undefined, Symbol.for("replacement"), { a: "of the replacement", tell: () => "told by the replacement" }, same]) {
  owner.exports = replacement;
  console.log(`replaced later with ${show(replacement)}:`, require("./with-the-same-object.cjs") === replacement);
  attempt("  read", () => require("./with-the-same-object.cjs").a);
  attempt("  call", () => require("./with-the-same-object.cjs").tell());
  attempt("  store", () => (require("./with-the-same-object.cjs").a = "stored later"));
  attempt("  the module stores", () => same.storeLate(show(replacement)));
}
describe("with-the-same-object in the end", same);
