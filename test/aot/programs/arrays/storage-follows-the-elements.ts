// The code that creates an array allocates the storage that fits the elements the build found for it, and the code that reads it expects that storage. Each array here is created with small integers in view and then gets, at run time, what such storage cannot hold: a fraction, NaN, -0, undefined, a string, a hole, an element far past the end, a shorter and a longer length. Every read answers as in plain Bun.
function sum(list: number[]): string {
  let total = 0, holes = 0;
  for (let i = 0; i < list.length; ++i) {
    const element = list[i];
    if (element === undefined) ++holes; else total += element;
  }
  return total + " (" + list.length + " long, " + holes + " missing)";
}
function chase(list: number[], key: number): number {
  key = list[key];
  key = list[key];
  key = list[key];
  return key;
}
function integers(count: number): number[] {
  const list: number[] = [];
  for (let i = 0; i < count; ++i) list.push((i * 7 + 1) & 7);
  return list;
}
const count = process.argv.length > 100 ? 3 : 8;

const plain = integers(count);
console.log("integers:", sum(plain), chase(plain, 1), chase(plain, 7), chase(plain, 100));

const withFraction = integers(count);
withFraction.push(0.5);
console.log("a fraction:", sum(withFraction), withFraction[8], chase(withFraction, 8));

const withNaN = integers(count);
withNaN[2] = NaN;
console.log("NaN:", sum(withNaN), withNaN[2], chase(withNaN, 2));

const withNegativeZero = integers(count);
withNegativeZero[0] = -0;
console.log("-0:", sum(withNegativeZero), Object.is(withNegativeZero[0], -0), 1 / withNegativeZero[0]);

const withUndefined = integers(count) as (number | undefined)[];
withUndefined[3] = undefined;
console.log("undefined:", sum(withUndefined as number[]), withUndefined[3], 3 in withUndefined);

const withString = integers(count) as unknown[];
withString[1] = "one";
console.log("a string:", withString.join(), typeof withString[1], typeof withString[2]);

const withHole = integers(count);
delete withHole[4];
console.log("a hole:", sum(withHole), 4 in withHole, withHole[4]);

const farPastTheEnd = integers(count);
farPastTheEnd[100] = 1;
console.log("far past the end:", sum(farPastTheEnd), farPastTheEnd[100], farPastTheEnd[99]);

const veryFar = integers(count);
veryFar[5000000] = 2;
console.log("very far past the end:", veryFar.length, veryFar[5000000], veryFar[4999999], veryFar[1]);

const shorter = integers(count);
shorter.length = 2;
console.log("a shorter length:", sum(shorter), shorter[2], chase(shorter, 0));

const longer = integers(count);
longer.length = 12;
console.log("a longer length:", sum(longer), longer[11], 11 in longer);

const ofHoles: number[] = new Array(5);
ofHoles[1] = 3;
console.log("new Array(5):", sum(ofHoles), ofHoles[0], ofHoles[1]);

const large = integers(count);
large.push(2147483648, -2147483649);
console.log("past 32 bits:", sum(large), large[8], large[9]);

const named = integers(count) as number[] & Record<string, number>;
named["undefined"] = 42;
named["-1"] = 43;
named["1.5"] = 44;
console.log("names that are no indexes:", named[undefined as unknown as number], named[-1], named[1.5], chase(named, 100), sum(named));

function make(first: unknown): unknown[] { return [first]; }
const madeWithInteger = make(1), madeWithString = make("s");
console.log("one literal, two contents:", madeWithInteger[0], madeWithString[0], madeWithInteger.length + madeWithString.length);
