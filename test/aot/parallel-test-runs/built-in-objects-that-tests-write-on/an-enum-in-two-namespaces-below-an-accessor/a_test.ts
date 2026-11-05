import { test } from "bun:test";
const hits: unknown[] = [];
Object.defineProperty(Object.prototype, "Ready", {
  configurable: true,
  get() {
    return "above";
  },
  set(value) {
    hits.push(value);
  },
});
namespace Outer {
  export namespace Inner {
    export enum State {
      Ready = 4,
      Done,
    }
  }
}
test("an enum in a namespace in a namespace", () => {
  const made = Outer.Inner.State as unknown as Record<string, unknown>;
  console.log(Object.keys(made).join(), String(made.Ready), String(made[4]), hits.join());
  delete (Object.prototype as Record<string, unknown>).Ready;
});
