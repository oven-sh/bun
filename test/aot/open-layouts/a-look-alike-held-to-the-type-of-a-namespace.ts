namespace Debug {
  export let level = 1;
  export function twice(value: number): number {
    return value * 2 * level;
  }
}
function silence(): void {
  (Debug as any).twice = () => -1;
}
function lookAlike(): any {
  return { level: 9, twice: (value: number) => value };
}
const either: typeof Debug = lookAlike();
console.log(either.twice(7), either.level, Debug.twice(7));
silence();
console.log(either.twice(7), Debug.twice(7));
