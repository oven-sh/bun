console.log("strict:", (function () {
  return this === undefined;
})());

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (value === globalThis) return "the global object";
  if (Array.isArray(value)) return "[" + Array.from(value, (item, index) => (index in value ? show(item) : "hole")).join(", ") + "]";
  var tag = Object.prototype.toString.call(value).slice(8, -1);
  if (tag === "Arguments") return "arguments" + show(Array.from(value));
  if (/^(Number|String|Boolean|BigInt|Symbol)$/.test(tag)) return "boxed " + show(Object.getPrototypeOf(value).valueOf.call(value));
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

globalThis.marker = "the marker of the global object";
var holder = {
  marker: "the marker of the holder",
  list: [1, 2, 3],
  read: function () {
    return this.marker;
  },
  kind: function () {
    return this === undefined ? "undefined" : this === globalThis ? "the global object" : this === holder ? "the holder" : typeof this;
  },
  size: function () {
    return this.list.length;
  },
};

var sum = 0;
for (var i = 0; i < 2000; i++) sum += holder.read().length + holder.size() + holder.kind().length;
console.log("sum", sum);

var ways = {
  "as a method": name => holder[name](),
  "in parentheses": name => (holder[name])(),
  "optional call": name => holder[name]?.(),
  "tagged template": name => holder[name]``,
  "from a variable": name => {
    var callee = holder[name];
    return callee();
  },
  "after a comma": name => (0, holder[name])(),
  "out of a conditional": name => (name ? holder[name] : null)(),
  "out of a logical or": name => (holder[name] || null)(),
  "out of an assignment": name => (holder.copy = holder[name])(),
  "call()": name => holder[name].call(),
  "call(undefined)": name => holder[name].call(undefined),
  "call(null)": name => holder[name].call(null),
  "apply()": name => holder[name].apply(),
  "Reflect.apply": name => Reflect.apply(holder[name], undefined, []),
  "bind()": name => holder[name].bind()(),
  "a callback of map": name => [0].map(holder[name])[0],
  "a caller made of text": name => new Function("callee", "return callee()")(holder[name]),
  "destructured": name => {
    var { [name]: callee } = holder;
    return callee();
  },
};
function everything(when) {
  for (var way in ways) for (var name of ["kind", "read", "size"]) attempt(when + " " + name + " " + way, ways[way].bind(null, name));
}
everything("no global list:");
globalThis.list = "four";
everything("a global text:");
delete globalThis.list;
delete globalThis.marker;
