namespace Debug {
  export let level = 1;
  export function twice(value: number): number {
    return value * 2 * level;
  }
}
console.log(Debug.twice(2));

const outside: any = globalThis;
outside.debug = Debug;
outside.debug.level = 3;
outside.debug.extra = true;
console.log(Debug.twice(2), Object.keys(Debug).join());
