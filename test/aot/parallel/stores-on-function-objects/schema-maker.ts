// A library makes every schema a function object: a fresh function, its prototype replaced by an object with getters and methods, options assigned, two stores.
const hidden = Symbol("hidden");
const log: string[] = [];
const Kind = {
  tag: "kind",
  get lazy() {
    log.push("lazy of " + (this as any).tree.leaf);
    Object.defineProperty(this, "lazy", { value: 7, enumerable: true });
    return 7;
  },
  pipe() {
    return "piped " + (this as any).tree.leaf;
  },
  rebuild(this: any, tree: object) {
    return make(tree, this[hidden]);
  },
};
function make(tree: object, options?: object): any {
  function Made() {}
  const self: any = Object.setPrototypeOf(Made, Kind);
  Object.assign(self, options);
  self[hidden] = options;
  self.tree = tree;
  return self;
}
for (let round = 0; round < 4; round++) {
  const first = make({ leaf: round }, { fields: [round], mode: "strict" });
  const second = first.rebuild({ leaf: round + 10 });
  const bare = make({ leaf: -round });
  for (const made of [first, second, bare]) {
    log.push([typeof made, made.tag, made.pipe(), made.lazy, made.lazy, made.mode, JSON.stringify(made.fields), Object.keys(made).join(), Reflect.ownKeys(made).map(String).join(), Object.getPrototypeOf(made) === Kind, made instanceof Function, made.name, made.length].join(" | "));
  }
}
console.log(log.join("\n"));
