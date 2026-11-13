const adapterA = { get: node => node.value, kind: "A" };
const adapterB = { get: node => node.value * 2, kind: "B" };
const defaults = { adapter: adapterA, depth: 1, onError: null, list: [1, 2] };
class Node {
  constructor(value) {
    this.value = value;
  }
}
class Reader {
  constructor(options) {
    this.options = { ...defaults, ...options };
    this.adapter = this.options.adapter;
  }
  read(node) {
    return this.adapter.get(node) + this.options.depth;
  }
}
function fill(options, i) {
  options.adapter ??= i & 1 ? adapterB : adapterA;
  if (i % 3 === 0) options.depth = i;
  if (i % 4 === 1) options.onError = error => "error " + error;
  if (i % 5 === 2) options["name" + (i & 1)] = "named";
  return options;
}
function fragment(context, text, options) {
  if (typeof context === "string") {
    options = text;
    text = context;
    context = null;
  }
  const all = { ...defaults, ...options };
  return all.adapter.kind + all.depth + (all[0] ?? "") + Object.keys(all).length + text;
}
function show(object) {
  let shown = "";
  for (const key of Object.keys(object)) shown += key + ":" + (typeof object[key] === "object" && object[key] ? (object[key].kind ?? object[key].length) : typeof object[key] === "function" ? "function" : object[key]) + " ";
  return shown;
}
const shared = { depth: 7 };
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < 9; i++) {
    const options = fill({}, i);
    const reader = new Reader(options);
    console.log(reader.read(new Node(i)), show(reader.options), show({ ...options }), reader.options.onError?.(i) ?? "none");
    options.late = i;
    console.log(show({ ...options, depth: -1 }), show({ ...fill(shared, i) }), "late" in { ...options }, "late" in reader.options);
    if (i === 4) delete options.adapter;
    if (i === 5) Object.defineProperty(options, "hidden", { value: 1, enumerable: false });
    if (i === 6) Object.defineProperty(options, "depth", { get: () => 60 + round, enumerable: true, configurable: true });
    console.log(show({ ...defaults, ...options }), new Reader(options).read(new Node(1)));
  }
  console.log(fragment(null, "x", { depth: 3 }), fragment("text", "ab"), fragment("text", { adapter: adapterB }), fragment(null, "y"), show({ ..."hey" }));
  console.log(show({ ...defaults, ...(round ? "str" : shared) }), show({ ...null, ...undefined, ...5, ...shared }));
}
let sum = 0;
for (let i = 0; i < 3000; i++) sum += new Reader(fill({}, i)).read(new Node(i));
console.log(sum);
