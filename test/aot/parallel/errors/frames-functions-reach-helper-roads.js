// One helper gives every function object its name. It is also handed values that nothing is known about, and some function objects reach it by long roads:
// out of a property descriptor, out of objects within objects, out of a list, a Map, a prototype. Each frame shows the name of its own function object.
const top = stack =>
  String(stack)
    .split("\n")
    .filter(line => line.trimStart().startsWith("at "))
    .slice(0, 2)
    .map(line => line.trim().replace(/ ?\(?[^ (]*:\d+:\d+\)?$/, ""))
    .join(" | ");
const rename = (f, n) => Object.defineProperty(f, "name", { value: n });

if (process.argv.length > 9) Object.defineProperty(globalThis, process.argv[9], JSON.parse(process.argv[10]));

try {
  rename(Reflect.get(globalThis, process.argv[9]), "nothing");
} catch {}

const roads = {
  written(n) {
    return rename(function () {
      return new Error("x").stack;
    }, n);
  },
  arrow(n) {
    return rename(() => new Error("x").stack, n);
  },
  method(n) {
    return rename(
      {
        m() {
          return new Error("x").stack;
        },
      }.m,
      n,
    );
  },
  getter(n) {
    return rename(
      Object.getOwnPropertyDescriptor(
        {
          get g() {
            return new Error("x").stack;
          },
        },
        "g",
      ).get,
      n,
    );
  },
  setter(n) {
    let stack;
    const set = Object.getOwnPropertyDescriptor(
      {
        set s(value) {
          stack = new Error("x").stack;
        },
      },
      "s",
    ).set;
    rename(set, n);
    return () => (set(1), stack);
  },
  objectsWithinObjects(n) {
    const first = {
      f: function () {
        return new Error("x").stack;
      },
    };
    const fourth = { third: { second: { first } } };
    return rename(fourth.third.second.first.f, n);
  },
  lists(n) {
    const lists = [[[() => new Error("x").stack]]];
    return rename(lists[0][0][0], n);
  },
  map(n) {
    const map = new Map([["f", new Map([["f", () => new Error("x").stack]])]]);
    return rename(map.get("f").get("f"), n);
  },
  prototype(n) {
    class K {
      m() {
        return new Error("x").stack;
      }
    }
    class L extends K {}
    return rename(Object.getPrototypeOf(Object.getPrototypeOf(new L())).m, n);
  },
  entries(n) {
    const [[, f]] = Object.entries({
      f() {
        return new Error("x").stack;
      },
    });
    return rename(f, n);
  },
  calls(n) {
    const same = value => value;
    const boxed = value => ({ value });
    return rename(same(boxed(same(boxed(() => new Error("x").stack).value)).value), n);
  },
};
for (const road in roads) {
  const a = roads[road]("a1"),
    b = roads[road]("b1");
  console.log(road, top(a()), "/", top(b()), "/", top(a.call(null)), "/", top(Reflect.apply(b, null, [])));
}
console.log("bound", top(rename(roads.written("target").bind(null), "bound-renamed")()));
console.log("parsed", Object.keys(rename(JSON.parse("{}"), "parsed")).length);
