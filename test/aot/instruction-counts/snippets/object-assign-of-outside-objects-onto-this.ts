// assigns an object of unknown type that holds four objects to this in a method of a class
class Router {
  key: string | undefined = "k";
  count = 0;
  origin!: string;
  byId!: Record<string, number>;
  byPath!: Record<string, number>;
  tree!: { depth: number };
  paths!: Map<string, string>;
  light!: WeakMap<object, number>;
  setRoutes(caches: any) {
    Object.assign(this, caches);
  }
}
const kept: { [name: string]: any } = {};
kept.first = { ...{ byId: { a: 1 }, byPath: { b: 2 } }, tree: { depth: 3 }, paths: new Map() };
kept.second = { ...{ byId: { a: 4 }, byPath: { b: 5 } }, tree: { depth: 6 }, paths: new Map() };
const router = new Router();
const operations = 40;
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    router.setRoutes(i & 1 ? kept.first : kept.second);
    sum += router.tree.depth;
  }
}

console.log(sum);
