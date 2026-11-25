// The spy is laid and taken away again; no loop calls push.
import { spyOn, test } from "bun:test";
import { byIndex, doubled, found, joined, pairs, pastTheEnd, steppedWithHook, total, withHook } from "./app";
const named = (...parts: string[]): string => parts.join("");
class Row extends Array<number> {
  *[Symbol.iterator](): ArrayIterator<number> {
    for (let at = this.length - 1; at >= 0; at--) yield this[at] + 100;
  }
}
function lists(): Record<string, number[]> {
  const size = named("abc").length;
  const whole = [1, 2, 3].map(value => value + size - 3);
  const fractions = whole.map(value => value + 0.5);
  const holes = [1, , 3] as number[];
  const accessor = [1, 2, 3];
  Object.defineProperty(accessor, "1", { get() { return 40; }, configurable: true, enumerable: true });
  const stepped = [1, 2, 3];
  (stepped as any)[Symbol.iterator] = function* () { yield 7; yield 8; };
  const row = Row.from([1, 2, 3]) as Row;
  const frozen = Object.freeze([4, 5, 6]) as number[];
  const sparse: number[] = [];
  sparse[70000] = 5;
  sparse.length = 3;
  sparse[1] = 9;
  const behind = new Proxy([1, 2, 3], { get(target, key, receiver) { return key === "1" ? 60 : Reflect.get(target, key, receiver); } });
  const tagged = [1, 2, 3];
  (tagged as any).tag = size;
  return { whole, fractions, holes, accessor, stepped, row, frozen, sparse, behind, tagged };
}
function all(): string {
  const shown: unknown[] = [];
  for (const [name, list] of Object.entries(lists())) {
    for (const ask of [() => total(list), () => byIndex(list), () => pastTheEnd(list), () => pairs(list, list), () => found(list, 2), () => doubled(list)]) {
      try {
        shown.push(ask());
      } catch (error) {
        shown.push((error as Error).constructor.name);
      }
    }
    shown.push(name);
  }
  shown.push(joined([named("a", "b"), named("c")]));
  return shown.join(" ");
}
test("The spy is laid and taken away again; no loop calls push.", () => {
  console.log(all());
  const spy = spyOn(Array.prototype, "push");
  const grown: number[] = [];
  grown.push(1);
  console.log(all(), spy.mock.calls.length);
  spy.mockRestore();
  console.log(all());
});
