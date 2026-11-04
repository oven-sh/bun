// a pattern is handed undefined, null, a text and an object of another shape in the place of the record that is written: the first two throw in front of every read, the others are read by name
type Options = { a: number; b: number };

let reads = "";
function sum(options: Options): number {
  const { a, b } = options;
  return a + b;
}

function deed(turn: number): Options {
  const hostile: unknown[] = [undefined, null, "text", { b: 2, a: 1, c: 3 }, { get a() { reads += "a"; return 4; }, get b() { reads += "b"; return 5; } }];
  return hostile[turn % 5] as Options;
}

function tell(options: Options): string {
  try {
    return String(sum(options));
  } catch (error) {
    return (error as Error).name;
  }
}

console.log(tell({ a: 1, b: 2 }));
let seen = "";
for (let i = 0; i < 300; i++) seen = tell({ a: i, b: 1 });
console.log(seen);
for (let i = 0; i < 10; i++) console.log(tell(deed(i)), reads);
console.log(tell({ a: 1, b: 2 }));
