// A builder as libraries write it: generic over the definition it is handed; each caller hands a literal of its own shape.
type Base = { name: string; run(x: number): number; cost?: number; readonly label?: string; extra?: unknown };
type Defaults = { enabled(): boolean; cost: number; title(): string };
type Built<D extends Base> = Omit<D, keyof Defaults> & Defaults & { describe(): string };
const DEFAULTS = { enabled: () => true, cost: 1 };
export function build<D extends Base>(def: D): Built<D> {
  const facing = { describe: () => def.name + ":" + (def.cost ?? 0) };
  const built: Built<Base> = Object.assign(
    Object.defineProperties({ ...DEFAULTS, title: () => def.name }, Object.getOwnPropertyDescriptors(def)),
    facing,
  ) as unknown as Built<Base>;
  return built as unknown as Built<D>;
}
const a = build({ name: "a", run: x => x * 2 });
const b = build({ name: "b", cost: 3, get label() { return "[" + this.name + "]"; }, run: x => x * x });
const c = build({ name: "c", extra: [1, 2], run: x => -x, more: 1 });
const d = build({ name: "d", run(x) { return x + 1; }, other: "o", another: { deep: true } });
const e = build(Object.assign({ name: "e", run: (x: number) => x }, JSON.parse('{"parsed":1}')));
console.log([a, b, c, d, e].map(tool => tool.name + " " + tool.describe() + " " + tool.run(3) + " " + Object.keys(tool).join()).join(" | "), b.label);
