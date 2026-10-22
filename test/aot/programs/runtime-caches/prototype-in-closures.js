// `"prototype" in f` on closures, in loops long enough to be cached. Functions with and without a `prototype` can share a Structure, so the answer for one must not be cached for the other.
const turns = JSON.parse("40");
const builtKey = JSON.parse('["proto","type"]').join("");
const lines = [];

function hasLiteral(f) {
  const answers = new Set();
  for (let i = 0; i < turns; i++) answers.add("prototype" in f);
  return [...answers].join("|");
}
function has(f, key) {
  const answers = new Set();
  for (let i = 0; i < turns; i++) answers.add(key in f);
  return [...answers].join("|");
}
function say(what, f) { lines.push(what + ": " + hasLiteral(f) + " " + has(f, "prototype") + " " + has(f, builtKey)); }

const holder = { method() {}, async asyncMethod() {} };
say("arrow", () => 1);
say("second arrow", () => 2);
say("async arrow", async () => 1);
say("method", holder.method);
say("async method", holder.asyncMethod);
say("async function", async function () {});
say("plain function", function () {});
say("second plain function", function () {});
say("generator", function* () {});
say("class", class {});
say("bound function", function () {}.bind(null));
say("arrow after plain functions", () => 3);

const assigned = () => 4;
assigned.prototype = 1;
say("arrow with an assigned prototype", assigned);
say("arrow after that one", () => 5);

const inheriting = () => 6;
Object.setPrototypeOf(inheriting, function () {});
say("arrow below a plain function", inheriting);
say("arrow after that one", () => 7);

console.log(lines.join("\n"));
