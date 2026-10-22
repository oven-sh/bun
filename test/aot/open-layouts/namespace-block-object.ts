namespace Debug {
  export let level = 1;
  export function assert(condition: unknown, message?: string): void {
    if (!condition) throw new Error(message ?? "no");
  }
  export function twice(value: number): number {
    return value * 2 * level;
  }
  export namespace Inner {
    export const name = "inner";
    export function shout(): string {
      return name.toUpperCase() + level;
    }
  }
}
namespace Debug {
  export function thrice(value: number): number {
    return value * 3 * level;
  }
}
const kept: Partial<Record<"twice" | "thrice", (value: number) => number>> = {};
function silence(name: "twice" | "thrice"): void {
  kept[name] = Debug[name];
  (Debug as any)[name] = () => -1;
}
Debug.assert(Debug.twice(2) === 4);
console.log(Debug.twice(2), Debug.thrice(2), Debug.Inner.shout());
silence("twice");
Debug.level = 5;
console.log(Debug.twice(2), Debug.thrice(2), Debug.Inner.shout(), typeof kept.twice, kept.twice?.(1));

interface Control {
  control: number;
}
const control: Control = JSON.parse('{"control":1}');
console.log(control.control);
