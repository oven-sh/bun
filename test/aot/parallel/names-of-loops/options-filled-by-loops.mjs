class Node {
  constructor(value) {
    this.value = value;
  }
  read() {
    return this.value;
  }
}
const defaults = { version: null, kind: "script", onToken: null, node: null, depth: 1 };
function fill(given) {
  const options = {};
  for (const name in defaults) options[name] = given && Object.hasOwn(given, name) ? given[name] : defaults[name];
  if (Array.isArray(options.onToken)) {
    const tokens = options.onToken;
    options.onToken = token => tokens.push(token);
  }
  return options;
}
function show(options) {
  const link = Object.getPrototypeOf(options);
  return Object.keys(options).join() + " " + (link === Object.prototype ? "plain" : link === null ? "null" : "other") + " " + (options.node?.read() ?? options.node) + " " + options.kind + " " + typeof options.onToken;
}
const tokens = [];
for (let i = 0; i < 6; i++) {
  console.log(show(fill({ node: new Node(i), kind: i & 1 ? "module" : undefined, unknown: 1, onToken: i === 2 ? tokens : i === 3 ? () => 1 : null })));
  console.log(show(fill(i & 1 ? null : undefined)), show(fill({})), show(fill({ __proto__: { node: new Node(9) } })));
}
fill({ onToken: tokens }).onToken(new Node(5));
console.log(tokens.length, tokens[0].read());

function copy(from, to) {
  for (const name in from) to[name] = from[name];
  return to;
}
const owns = JSON.parse('{ "a": 1, "__proto__": { "b": 2 } }');
const spelled = { a: 1, ["__proto__"]: new Node(3) };
const defined = Object.defineProperty({ a: 1 }, "__proto__", { value: new Node(4), enumerable: true, configurable: true, writable: true });
const below = Object.create({ a: 1, ["__proto__"]: new Node(6) });
const late = { a: 1 };
for (const from of [owns, spelled, defined, below, late, "text", 5, null]) {
  const to = copy(from, { first: 0 });
  console.log(Object.keys(to).join(), Object.getPrototypeOf(to) === Object.prototype, typeof to.read, typeof to.b);
}
late["__pro" + "to__"] = new Node(7);
late.b = 2;
console.log(Object.keys(copy(late, {})).join(), typeof copy(late, {}).read);

const table = { x: 1, y: 2 };
function fillFrom(source, value) {
  const made = {};
  for (const name in source) made[name] = value;
  return made;
}
console.log(Object.keys(fillFrom(table, new Node(1))).join(), fillFrom(table, new Node(2)).y.read());
table["__proto__"] = { z: 3 };
console.log(Object.keys(fillFrom(table, new Node(1))).join(), fillFrom(table, new Node(2)).z.read(), Object.getPrototypeOf(fillFrom(table, new Node(1))) === Object.prototype);
Object.defineProperty(table, "__proto__", { value: 1, enumerable: true });
console.log(Object.keys(fillFrom(table, new Node(1))).join(), fillFrom(table, new Node(8)).value);
