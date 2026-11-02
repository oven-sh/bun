// One pair of a number and a text is handed to a generator, and read through call(), Reflect.apply(), a pattern and a generic function.
// Flags: --aot-verify-each-pass
type Seen = (number | string | undefined)[];
function same<T>(it: T): T {
  return it;
}
function* echo<T>(first: T): Generator<T, void, T> {}
const lengthAndNumber = (it: [number, string], at: number) => it[1].length + it[0];
const readers = {
  text(it: [number, string], at: number) {
    return it[1];
  },
};
function scene(given: number[]): Seen {
  const seen: Seen = [];
  const other: [number, string] = [-1, "t" + -1] as [number, string];
  let older: [number, string] = other;
  let kept: [number, string] = other;
  let last: [number, string] = other;
  const steps = echo<[number, string]>(other);
  steps.next();
  for (const [at] of [...given, 1].entries()) {
  }
  seen.push(readers.text.call(undefined, kept, 1));
  seen.push(same(last[1]));
  seen.push((() => (([n, t]: [number, string]) => t + n)(other))());
  seen.push(Reflect.apply(lengthAndNumber, undefined, [older, 1]));
  return seen;
}
const said = new Set<string>();
for (let turn = 0; turn < 3; turn++) said.add(JSON.stringify(scene(turn % 7 ? [5, 6, 7] : [turn, 2])));
console.log([...said].join(" "));
