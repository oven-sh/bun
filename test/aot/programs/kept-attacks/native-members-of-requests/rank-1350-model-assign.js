// A class whose constructor makes a function that closes over `this`, and calls it: the function creates fields of the object that is being made.
class Router {
  constructor(options) {
    this.key = "k" + options.id;
    this.subscribers = new Set();
    this.cache = new Map();
    this.update = newOptions => {
      const previous = this.options;
      this.options = newOptions;
      this.isServer = newOptions.isServer ?? previous === undefined;
      this.origin = newOptions.origin;
      if (!this.origin) this.origin = "http://localhost";
      const basepath = newOptions.basepath ?? "/";
      if (this.basepath !== basepath) {
        this.basepath = basepath;
        this.rewrite = basepath !== "/" ? basepath : undefined;
      }
      if (newOptions.tree !== this.tree) {
        this.tree = newOptions.tree;
        this.setRoutes({ routesById: tree, routesByPath: tree });
      }
      if (!this.stores) {
        this.batch = newOptions.id;
        this.stores = [newOptions.id];
      }
    };
    this.describe = () => this.key + this.origin + this.basepath + this.batch + this.stores.length + this.isServer + (this.tree === this.options.tree);
    this.update(options);
  }
  setRoutes(caches) {
    Object.assign(this, caches);
    this.lightweight = new WeakMap();
  }
}
const tree = { id: 0 };
const rounds = Number(process.argv[2] ?? 3);
let length = 0;
for (let round = 0; round < rounds; round++) {
  const router = new Router({ id: round, tree, origin: round & 1 ? "http://a" : undefined });
  if (round % 3 === 0) router.update({ id: round + 1, tree, basepath: "/b" });
  length += router.describe().length;
}
console.log(length);
