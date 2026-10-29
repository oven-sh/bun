// `xs.map(..)`, filter, Array.from, JSON.parse, a spread: general code makes an array with storage for any value, also where all that it stores are numbers.
// A loop over a `number[]` asks for storage of numbers in front of itself, and gives such an array that storage. Nothing that a program can see may change by it:
// holes stay holes, NaN and -0 stay what they are, an array that holds anything else stays as it is, and whatever is stored later is read back.
function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i]!;
  return total;
}
function describe(values: unknown[]): string {
  let text = "";
  for (let i = 0; i < values.length; i++) text += (i in values ? (Object.is(values[i], -0) ? "-0" : String(values[i])) : "hole") + ",";
  return text + values.length;
}
function check(name: string, numbers: number[]) {
  const before = describe(numbers);
  const first = sum(numbers);
  const second = sum(numbers);
  console.log(name, first, Object.is(first, second), before === describe(numbers), describe(numbers));
}
const source = [3, 1, 4, 1, 5, 9, 2, 6];
check("map", source.map(x => x));
check("map to fractions", source.map(x => x / 2));
check("filter", source.filter(x => x > 1));
check("from", Array.from({ length: 5 }, (_, i) => i * 3));
check("parsed", JSON.parse("[1, 2.5, -3, 1e300]"));
check("spread", [...new Set(source)]);
check("negative zero", source.map(x => (x === 4 ? -0 : x)));
check("not a number", source.map(x => (x === 4 ? NaN : x)));
check("infinite", source.map(x => (x === 4 ? -Infinity : x)));
check("tiny", source.map(x => (x === 4 ? 5e-324 : x)));
check("empty", source.filter(x => x > 100));
const holes = source.map(x => x);
delete holes[2];
holes.length = 12;
check("holes", holes);
check("a text among them", (source as unknown[]).map(x => (x === 9 ? "nine" : x)) as number[]);
check("undefined among them", (source as unknown[]).map(x => (x === 9 ? undefined : x)) as number[]);
check("an object among them", (source as unknown[]).map(x => (x === 9 ? { valueOf: () => 9 } : x)) as number[]);

// What is stored behind the loop is read back, whatever it is.
const later: unknown[] = source.map(x => x);
console.log(sum(later as number[]));
later.push("text");
later[1] = { a: 1 };
later[20] = 7;
console.log(describe(later), JSON.stringify(later));
const grown = source.map(x => x);
console.log(sum(grown));
for (let i = 0; i < 100; i++) grown.push(i + 0.5);
console.log(sum(grown), grown.length, grown.indexOf(99.5), grown.includes(6), grown.slice(-2).join());

// With a name of its own, frozen, or of a class below Array, it is read as it is.
const named = source.map(x => x) as number[] & { label?: string };
named.label = "named";
console.log(sum(named), named.label, Object.keys(named).length);
const frozen = Object.freeze(source.map(x => x)) as number[];
console.log(sum(frozen), Object.isFrozen(frozen));
class Numbers extends Array<number> {}
const below = Numbers.from(source).map(x => x + 1);
console.log(sum(below), below instanceof Numbers, below.length);

// Two names for one array see one array.
const shared = source.map(x => x);
const other: unknown[] = shared;
console.log(sum(shared));
other[0] = "first";
console.log(describe(shared), shared === other);
