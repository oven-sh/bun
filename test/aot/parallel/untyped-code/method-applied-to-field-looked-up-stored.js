// A method applied to a field is looked up on what is stored there.
const headersPrototype = {
  get(name) {
    return this.values[name.toLowerCase()];
  },
  set(name, value) {
    this.values[name.toLowerCase()] = value;
    return this;
  },
};

const holderPrototype = {
  get() {
    return this.headers.get.apply(this.headers, arguments);
  },
  set() {
    return this.headers.set.apply(this.headers, arguments);
  },
  has() {
    return this.headers.get.call(this.headers, arguments[0]) !== undefined;
  },
};

function createHolder() {
  const holder = Object.create(holderPrototype);
  const headers = (holder.headers = Object.create(headersPrototype));
  headers.values = {};
  return holder;
}

const cache = new Map();
let found = 0;
for (let i = 0; i < 1000; i++) {
  const holder = createHolder();
  holder.set("Content-Length", i);
  cache.set(i % 7, holder);
  if (holder.has("content-length")) found += holder.get("CONTENT-LENGTH");
}
console.log(found, cache.size, cache.get(3).get("content-length"));

const outer = Object.create(holderPrototype);
outer.headers = new Map([["a", 1]]);
console.log(outer.get("a"), outer.has("b"), outer.set("b", 2) === outer.headers, outer.get("b"));
outer.headers = createHolder();
outer.set("X", "inner");
console.log(outer.get("x"), outer.headers.headers.values.x);
outer.headers = { get: (...names) => names.join("+"), set: function () { return arguments.length; } };
console.log(outer.get("p", "q"), outer.set(1, 2, 3), outer.has());
outer.headers = { get: undefined };
try {
  outer.get("a");
} catch (error) {
  console.log(error instanceof TypeError);
}
outer.headers = undefined;
try {
  outer.set("a", 1);
} catch (error) {
  console.log(error instanceof TypeError);
}
