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
  const parsed = JSON.parse('{"level":9}');
  parsed.twice = (value: number) => value;
  return parsed;
}
const either: typeof Debug = lookAlike();
console.log(either.twice(7), either.level, Debug.twice(7));
silence();
console.log(either.twice(7), Debug.twice(7));

interface Control {
  control: number;
}
const control: Control = JSON.parse('{"control":1}');
console.log(control.control);
