// null and undefined can be stored into every declared property, whatever its type, as in plain Bun.
interface Inner { id: number }
interface Shape { count: number; name: string; done: boolean; inner: Inner; list: number[]; run: () => number }
class Entry implements Shape { count: number = 1; name: string = "n"; done: boolean = false; inner: Inner = { id: 1 }; list: number[] = [1]; run: () => number = () => 1; }
const makers: [string, () => any][] = [
  ["a class instance", () => new Entry()],
  ["a literal", () => { const shape: Shape = { count: 1, name: "n", done: false, inner: { id: 1 }, list: [1], run: () => 1 }; return shape; }],
];
for (const [how, make] of makers) {
  for (const nothing of [null, undefined]) {
    const o = make();
    for (const name of Object.keys(o)) o[name] = nothing;
    console.log(how + ":", Object.keys(o).map(name => String(o[name])).join(), JSON.stringify(o), Object.keys(o).join());
    o.count = nothing; o.name = nothing; o.done = nothing; o.inner = nothing; o.list = nothing; o.run = nothing;
    Reflect.set(o, "count", nothing);
    Object.assign(o, { name: nothing });
    Object.defineProperty(o, "done", { value: nothing });
    console.log("  by name:", o.count, o.name, o.done, o.inner, o.list, o.run, "count" in o);
    o.count = 2; o.name = "m"; o.done = true; o.inner = { id: 2 }; o.list = [2]; o.run = () => 2;
    console.log("  filled again:", o.count, o.name, o.done, o.inner.id, o.list[0], o.run());
  }
}
