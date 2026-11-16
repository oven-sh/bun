// The interfaces of `dom/` for the realm of a frame, which this module is evaluated in. They call those of the realm
// that has the modules, so that nodes can move between the documents.
const global: any = globalThis;
const { getOwnPropertyDescriptor, getPrototypeOf, setPrototypeOf, ownKeys, construct } = Reflect;

/** What they return came from a script. */
const passedThrough = new Set<PropertyKey>([
  "data",
  "detail",
  "error",
  "filter",
  "info",
  "reason",
  "returnValue",
  "state",
]);

class Mirror {
  page: any = null;
  #root: any;
  /** By the prototypes of the other realm. */
  #prototypes = new Map<object, object>();
  #constructors = new Map<Function, Function>();
  #own = new Set<Function>();
  #modules = new Map<string, object>();

  constructor(root: any) {
    this.#root = root;
    for (const [name, foreign] of root.natives) {
      const own = global[name];
      if (!$isCallable(own)) continue;
      this.#constructors.$set(foreign, own);
      this.#prototypes.$set(foreign.prototype, own.prototype);
    }
    this.#prototypes.$set(root.functionPrototype, Function.prototype);
    const iterator = getPrototypeOf(getPrototypeOf([][Symbol.iterator]())!)!;
    this.#prototypes.$set(root.iteratorPrototype, iterator);
  }

  /** `run` as a function of this realm. */
  wrap(run: Function, key?: PropertyKey): any {
    const mirror = this;
    const { realm } = this.#root;
    const isOpaque = passedThrough.$has(key!);
    const { method } = {
      method(this: unknown) {
        const before = realm.page;
        realm.page = mirror.page;
        try {
          const result = run.$apply(this, arguments);
          return isOpaque ? result : mirror.adopt(result);
        } catch (error) {
          throw mirror.adopt(error);
        } finally {
          realm.page = before;
        }
      },
    };
    return Object.defineProperties(method, { name: { value: run.name }, length: { value: run.length } });
  }

  copy(from: object, to: object, except: string[] = []) {
    for (const key of ownKeys(from)) {
      if (except.includes(key as string)) continue;
      const it = getOwnPropertyDescriptor(from, key)!;
      if (it.get) it.get = this.wrap(it.get, key);
      if (it.set) it.set = this.wrap(it.set);
      if ($isCallable(it.value))
        it.value = this.#root.arrayMethods.$has(it.value) ? Array.prototype[it.value.name] : this.wrap(it.value);
      else if (key === Symbol.unscopables) it.value = { __proto__: null, ...it.value };
      Object.defineProperty(to, key, it);
    }
  }

  prototypeFor(foreign: object | null): any {
    if (foreign === null) return null;
    const own = this.#prototypes.$get(foreign);
    if (own !== undefined) return own;
    const ctor = getOwnPropertyDescriptor(foreign, "constructor")?.value;
    if (this.#root.isInterface(ctor)) return this.constructorFor(ctor).prototype;
  }

  constructorFor(foreign: any): any {
    let own: any = this.#constructors.$get(foreign);
    if (own !== undefined) return own;
    const create = this.wrap((args: unknown[], newTarget: Function) => {
      if (newTarget !== own) return construct(foreign, args, newTarget);
      const made: any = construct(foreign, args);
      setPrototypeOf(made, own.prototype);
      return made;
    }, "data");
    own = function () {
      if (!new.target) throw new TypeError(`Failed to construct '${foreign.name}': Please use the 'new' operator.`);
      return create(arguments, new.target);
    };
    this.#constructors.$set(foreign, own);
    this.#own.$add(own);
    const base = getPrototypeOf(foreign);
    setPrototypeOf(own, base === this.#root.functionPrototype ? Function.prototype : this.constructorFor(base));
    this.copy(foreign, own, ["prototype", "arguments", "caller"]);
    const shared = this.#prototypes.$get(foreign.prototype);
    // `Image` and the like have the prototype of another interface.
    const isFactory = foreign.prototype.constructor !== foreign;
    const prototype = shared ?? (isFactory ? this.prototypeFor(foreign.prototype) : this.#newPrototype(foreign, own));
    Object.defineProperty(own, "prototype", { value: prototype, writable: false });
    return own;
  }

  #newPrototype(foreign: any, own: Function) {
    const prototype = Object.create(this.prototypeFor(getPrototypeOf(foreign.prototype)) ?? Object.prototype);
    this.#prototypes.$set(foreign.prototype, prototype);
    Object.defineProperty(prototype, "constructor", { value: own, writable: true, configurable: true });
    this.copy(foreign.prototype, prototype, ["constructor"]);
    const cloner = $getByIdDirectPrivate(foreign.prototype, "cloner");
    if (cloner !== undefined) $putByIdDirectPrivate(prototype, "cloner", cloner);
    return prototype;
  }

  /** Makes it an object of this realm, unless it is a node or a window: they know which realm they are of. */
  adopt(value: any) {
    if (!$isObject(value)) return value;
    if ($isCallable(value)) return this.#root.isInterface(value) ? this.constructorFor(value) : value;
    if (this.#root.hasRealm(value)) return value;
    const own = this.prototypeFor(getPrototypeOf(value));
    if (!own) return value;
    setPrototypeOf(value, own);
    if (own === Object.prototype)
      for (const key of ownKeys(value)) this.adopt(getOwnPropertyDescriptor(value, key)!.value);
    return value;
  }

  isInterface(own: any) {
    return own.prototype?.constructor === own && this.#own.$has(own);
  }

  adoptAll(value: any) {
    if ($isArray(value)) for (const it of value) this.adopt(it);
    this.adopt(value);
  }

  construct(foreign: Function) {
    return construct(foreign, [], this.constructorFor(foreign));
  }

  /** The exports of a module, for the modules of this realm. */
  module = (name: string) => {
    let found = this.#modules.$get(name);
    if (found !== undefined) return found;
    const exports = this.#root.modules[name];
    found = { __proto__: exports };
    for (const key in exports) {
      const value = exports[key];
      let own;
      if (key === "realm") own = { __proto__: value, page: this.page };
      else if (!$isCallable(value)) continue;
      else if (this.#constructors.$has(value) || this.#root.isInterface(value)) own = this.constructorFor(value);
      else if (getOwnPropertyDescriptor(value, "prototype")?.writable === false) continue;
      else own = this.wrap(value);
      Object.defineProperty(found, key, { value: own, enumerable: true });
    }
    this.#modules.$set(name, found!);
    return found;
  };
}

export default { Mirror };
