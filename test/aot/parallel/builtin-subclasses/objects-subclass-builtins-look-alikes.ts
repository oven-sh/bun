// Instances of classes below Map, Set, Error and Promise, and objects that only look like them, gain and lose names, change prototypes and hold values of other types in code the compiler cannot see.
class Defaults extends Map<string, number> {
  getOr(key: string, fallback: number): number {
    return this.get(key) ?? fallback;
  }
}
class Narrow extends Defaults {
  limit = 3;
  getOr(key: string, fallback: number): number {
    return Math.min(super.getOr(key, fallback), this.limit);
  }
}
class Tags extends Set<string> {
  toggle(tag: string): boolean {
    if (this.has(tag)) {
      this.delete(tag);
      return false;
    }
    this.add(tag);
    return true;
  }
}
class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
  isClient(): boolean {
    return this.status < 500;
  }
}
class Deferred extends Promise<number> {
  tag(): number {
    return 3;
  }
}
class Sealed extends Map<string, number> {
  #hits = 0;
  #bump(): number {
    return ++this.#hits;
  }
  count(key: string): number {
    return this.has(key) ? this.#bump() : -this.#hits;
  }
}

const change = new Function(
  "o",
  "how",
  `
  switch (how) {
    case "hide member": o.getOr = o.toggle = o.isClient = o.tag = o.count = () => "hidden"; break;
    case "show member": delete o.getOr; delete o.toggle; delete o.isClient; delete o.tag; delete o.count; break;
    case "hide built-in": o.get = o.has = () => "own"; break;
    case "show built-in": delete o.get; delete o.has; break;
    case "between": Object.setPrototypeOf(o, { __proto__: Object.getPrototypeOf(o), getOr() { return "between"; }, toggle() { return "between"; }, isClient() { return "between"; }, tag() { return "between"; }, count() { return "between"; } }); break;
    case "back": Object.setPrototypeOf(o, Object.getPrototypeOf(Object.getPrototypeOf(o))); break;
    case "many": for (let i = 0; i < 200; i++) o["extra" + i] = i; break;
    case "few": for (let i = 0; i < 200; i++) delete o["extra" + i]; break;
    case "freeze": Object.freeze(o); break;
    case "other type": o.status = "text"; o.limit = "wide"; break;
    case "stack": void o.stack; break;
  }
`,
) as (o: object, how: string) => void;

function useDefaults(d: Defaults): unknown {
  return [d.getOr("a", 9), d.getOr("b", 9), d.size, d instanceof Defaults, d instanceof Narrow, d instanceof Map];
}
function useTags(t: Tags): unknown {
  return [t.toggle("a"), t.toggle("a"), t.size, t instanceof Tags, t instanceof Set];
}
function useError(e: HttpError): unknown {
  return [e.isClient(), e.status, e.message, e instanceof HttpError, e instanceof Error];
}
function useDeferred(p: Deferred): unknown {
  return [p.tag(), p instanceof Deferred, p instanceof Promise];
}
function useSealed(s: Sealed): unknown {
  return [s.count("a"), s.count("b"), s instanceof Sealed];
}
function attempt(use: (o: any) => unknown, o: object): string {
  try {
    return JSON.stringify(use(o));
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}

const steps = ["hide member", "show member", "hide built-in", "show built-in", "between", "back", "many", "few", "other type", "stack", "freeze"];
const makers: [string, (o: any) => unknown, () => object][] = [
  ["Defaults", useDefaults, () => new Defaults([["a", 1]])],
  ["Narrow", useDefaults, () => new Narrow([["a", 7]])],
  ["Tags", useTags, () => new Tags(["a"])],
  ["HttpError", useError, () => new HttpError("no", 404)],
  ["Deferred", useDeferred, () => new Deferred(resolve => resolve(1))],
  ["Sealed", useSealed, () => new Sealed([["a", 1]])],
  ["Map for Defaults", useDefaults, () => Reflect.construct(Map, [[["a", 2]]], Defaults)],
  ["Defaults for Narrow", useDefaults, () => Reflect.construct(Defaults, [[["a", 8]]], Narrow)],
  ["Narrow for Defaults", useDefaults, () => Reflect.construct(Narrow, [[["a", 8]]], Defaults)],
  ["Defaults for Tags", useDefaults, () => Reflect.construct(Defaults, [], Tags)],
  ["Error for HttpError", useError, () => Reflect.construct(Error, ["made"], HttpError)],
  ["TypeError for HttpError", useError, () => Reflect.construct(TypeError, ["made"], HttpError)],
  ["a Map moved below Defaults", useDefaults, () => Object.setPrototypeOf(new Map([["a", 3]]), Defaults.prototype)],
  ["an Error moved below HttpError", useError, () => Object.setPrototypeOf(new Error("moved"), HttpError.prototype)],
  ["an object below Defaults", useDefaults, () => Object.create(Defaults.prototype)],
  ["an object below an instance", useDefaults, () => Object.create(new Defaults([["a", 4]]))],
  ["a Set moved below Defaults", useDefaults, () => Object.setPrototypeOf(new Set(["a"]), Defaults.prototype)],
];

for (const [name, use, make] of makers) {
  const warm = make();
  let last = "";
  for (let i = 0; i < 300; i++) last = attempt(use, warm);
  console.log(name, last);
  for (const step of steps) {
    const alone = make();
    change(alone, step);
    change(warm, step);
    console.log(name, "|", step, "|", attempt(use, alone), "|", attempt(use, warm), "|", attempt(use, make()));
  }
}

function classesMadeAgain(round: number): unknown {
  class Local extends Map<string, number> {
    twice(key: string): number {
      return (this.get(key) ?? round) * 2;
    }
  }
  return Local;
}
const first = classesMadeAgain(1) as new (entries: [string, number][]) => Map<string, number> & { twice(key: string): number };
const second = classesMadeAgain(2) as typeof first;
for (const made of [new first([["a", 5]]), new second([["a", 6]]), Reflect.construct(first, [[["a", 7]]], second)])
  console.log("made again", made.twice("a"), made.twice("b"), made instanceof first, made instanceof second);

(Defaults.prototype as any).getOr = function (this: Defaults, key: string) {
  return "replaced " + this.has(key);
};
console.log("member replaced", attempt(useDefaults, new Defaults([["a", 1]])), attempt(useDefaults, new Narrow([["a", 1]])));
Object.setPrototypeOf(Tags.prototype, {
  __proto__: Set.prototype,
  has() {
    return true;
  },
});
console.log("link changed", attempt(useTags, new Tags(["a"])));
Object.setPrototypeOf(HttpError, RangeError);
console.log("parent changed", attempt(useError, new HttpError("late", 500)), new HttpError("late", 500) instanceof RangeError);
