// Map and Set compare keys by SameValueZero whatever the key's static type is: -0 is 0, a double equal to an integer is that integer,
// every NaN is one key, strings and bigints compare by content, objects by identity.
type Letter = "a" | "b";

const half = (n: number) => n / 2;
const notANumber = Number("x");
const computedA = "a".repeat(1) + "";
const computedB = String.fromCharCode(98);
const object = {};

const numbers: number[] = [0, half(-0), 0.5, half(2), notANumber, -notANumber, 2 ** 31, half(2 ** 32)];
const optionalNumbers: (number | undefined)[] = [undefined, 0, half(-0), 0.5, half(2), notANumber, -notANumber, 2 ** 31];
const strings: string[] = ["a", computedA, "b", computedB, "", computedA + computedB, "ab", "1"];
const letters: Letter[] = ["a", computedA as Letter, "b", computedB as Letter];
const values: unknown[] = [0, half(-0), 0.5, half(2), notANumber, 2 ** 31, "a", computedA, 1n, BigInt("1"), object, {}, undefined, null, "1", 1, true];

function describe(key: unknown): string {
  if (typeof key === "number") return Object.is(key, -0) ? "-0" : String(key);
  if (typeof key === "string") return JSON.stringify(key);
  if (typeof key === "bigint") return key + "n";
  if (typeof key === "object" && key !== null) return key === object ? "object" : "another object";
  return String(key);
}

function answers(has: boolean, got: number | undefined, isMember: boolean, mapSize: number, setSize: number): string {
  return `${has} ${got} ${isMember} ${mapSize} ${setSize}`;
}

function hotNumbers(keys: number[], rounds: number): string {
  let first = "";
  let differing = 0;
  for (let round = 0; round < rounds; round++) {
    const map = new Map<number, number>();
    const set = new Set<number>();
    let text = "";
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i] * 1;
      text += describe(key) + ": " + answers(map.has(key), map.get(key), set.has(key), map.size, set.size);
      map.set(key, i);
      set.add(key);
      text += " -> " + answers(map.has(key), map.get(key), set.has(key), map.size, set.size) + "\n";
    }
    text += [...map.keys()].map(describe).join() + " | " + [...set].map(describe).join();
    if (!round) first = text;
    else if (text !== first) differing++;
  }
  return `${first}\nrounds that differ: ${differing}`;
}

function hotOptionalNumbers(keys: (number | undefined)[], rounds: number): string {
  let first = "";
  let differing = 0;
  for (let round = 0; round < rounds; round++) {
    const map = new Map<number | undefined, number>();
    const set = new Set<number | undefined>();
    let text = "";
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      text += describe(key) + ": " + answers(map.has(key), map.get(key), set.has(key), map.size, set.size);
      map.set(key, i);
      set.add(key);
      text += " -> " + answers(map.has(key), map.get(key), set.has(key), map.size, set.size) + "\n";
    }
    text += [...map.keys()].map(describe).join() + " | " + [...set].map(describe).join();
    if (!round) first = text;
    else if (text !== first) differing++;
  }
  return `${first}\nrounds that differ: ${differing}`;
}

function hotStrings(keys: string[], rounds: number): string {
  let first = "";
  let differing = 0;
  for (let round = 0; round < rounds; round++) {
    const map = new Map<string, number>();
    const set = new Set<string>();
    let text = "";
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      text += describe(key) + ": " + answers(map.has(key), map.get(key), set.has(key), map.size, set.size);
      map.set(key, i);
      set.add(key);
      text += " -> " + answers(map.has(key), map.get(key), set.has(key), map.size, set.size) + "\n";
    }
    text += [...map.keys()].map(describe).join() + " | " + [...set].map(describe).join() + ` | ${map.size} ${set.size}`;
    map.clear();
    set.clear();
    text += ` | ${map.size} ${set.size}`;
    if (!round) first = text;
    else if (text !== first) differing++;
  }
  return `${first}\nrounds that differ: ${differing}`;
}

function hotLetters(keys: Letter[], rounds: number): string {
  let first = "";
  let differing = 0;
  for (let round = 0; round < rounds; round++) {
    const map = new Map<Letter, number>();
    const set = new Set<Letter>();
    let text = "";
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      text += describe(key) + ": " + answers(map.has(key), map.get(key), set.has(key), map.size, set.size);
      map.set(key, i);
      set.add(key);
      text += " -> " + answers(map.has(key), map.get(key), set.has(key), map.size, set.size) + "\n";
    }
    text += [...map.keys()].map(describe).join() + " | " + [...set].map(describe).join();
    if (!round) first = text;
    else if (text !== first) differing++;
  }
  return `${first}\nrounds that differ: ${differing}`;
}

function hotValues(keys: unknown[], rounds: number): string {
  let first = "";
  let differing = 0;
  for (let round = 0; round < rounds; round++) {
    const map = new Map<unknown, number>();
    const set = new Set<unknown>();
    let text = "";
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      text += describe(key) + ": " + answers(map.has(key), map.get(key), set.has(key), map.size, set.size);
      map.set(key, i);
      set.add(key);
      text += " -> " + answers(map.has(key), map.get(key), set.has(key), map.size, set.size) + "\n";
    }
    text += [...map.keys()].map(describe).join() + " | " + [...set].map(describe).join();
    if (!round) first = text;
    else if (text !== first) differing++;
  }
  return `${first}\nrounds that differ: ${differing}`;
}

// An integer and the double that equals it are one key, inside and outside the int32 range.
function hotIntegers(rounds: number): string {
  const map = new Map<number, number>();
  const set = new Set<number>();
  let found = 0;
  for (let i = 0; i < rounds; i++) {
    const small = (i % 7) - 3;
    const large = 2 ** 31 + small;
    map.set(small, i);
    map.set(large, -i);
    set.add(small);
    set.add(large);
    if (map.get(half(small * 2)) === i && set.has(half(small * 2))) found++;
    if (map.get(half(large * 2)) === -i && set.has(half(large * 2))) found++;
  }
  return `${found} ${map.size} ${set.size} ${[...map.keys()].map(describe).join()}`;
}

// Negative case: a key typed as a union of literals is no pointer to compare. The tables hold strings that were computed.
function hotLettersAmongComputedStrings(map: Map<string, number>, set: Set<string>, keys: Letter[], rounds: number): string {
  let found = 0;
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (map.has(key) && set.has(key)) found++;
      sum += map.get(key) ?? -1000;
    }
  }
  return `${found} ${sum}`;
}

// An array of doubles gives a whole number back as a double, and an untyped read keeps it boxed that way.
function hotWholeDoubles(map: Map<number, string>, set: Set<number>, doubles: any, rounds: number): string {
  let found = 0;
  for (let round = 0; round < rounds; round++) {
    const key: number = doubles[1];
    if (map.has(key) && set.has(key) && map.get(key) === "two") found++;
  }
  return String(found);
}

const rounds = 200;
console.log(hotNumbers(numbers, rounds));
console.log(hotOptionalNumbers(optionalNumbers, rounds));
console.log(hotStrings(strings, rounds));
console.log(hotLetters(letters, rounds));
console.log(hotValues(values, rounds));
console.log(hotIntegers(rounds));

const computedStrings = new Map<string, number>([[computedA, 1], [computedB, 2]]);
const computedMembers = new Set<string>([computedA, computedB]);
console.log(hotLettersAmongComputedStrings(computedStrings, computedMembers, letters, rounds));

const doubles: any = [0.5, 1.5, 2.5];
doubles[1] = half(4);
const wholeNumbers = new Map<number, string>([[2, "two"]]);
const wholeMembers = new Set<number>([2]);
console.log(hotWholeDoubles(wholeNumbers, wholeMembers, doubles, rounds));

// The same outside loops.
const numberMap = new Map<number, number>();
const numberSet = new Set<number>();
function onceNumber(key: number): string {
  const before = answers(numberMap.has(key), numberMap.get(key), numberSet.has(key), numberMap.size, numberSet.size);
  numberMap.set(key, numberMap.size);
  numberSet.add(key);
  return `${describe(key)}: ${before} -> ${answers(numberMap.has(key), numberMap.get(key), numberSet.has(key), numberMap.size, numberSet.size)}`;
}

const optionalNumberMap = new Map<number | undefined, number>();
const optionalNumberSet = new Set<number | undefined>();
function onceOptionalNumber(key: number | undefined): string {
  const before = answers(optionalNumberMap.has(key), optionalNumberMap.get(key), optionalNumberSet.has(key), optionalNumberMap.size, optionalNumberSet.size);
  optionalNumberMap.set(key, optionalNumberMap.size);
  optionalNumberSet.add(key);
  return `${describe(key)}: ${before} -> ${answers(optionalNumberMap.has(key), optionalNumberMap.get(key), optionalNumberSet.has(key), optionalNumberMap.size, optionalNumberSet.size)}`;
}

const stringMap = new Map<string, number>();
const stringSet = new Set<string>();
function onceString(key: string): string {
  const before = answers(stringMap.has(key), stringMap.get(key), stringSet.has(key), stringMap.size, stringSet.size);
  stringMap.set(key, stringMap.size);
  stringSet.add(key);
  return `${describe(key)}: ${before} -> ${answers(stringMap.has(key), stringMap.get(key), stringSet.has(key), stringMap.size, stringSet.size)}`;
}

const letterMap = new Map<Letter, number>();
const letterSet = new Set<Letter>();
function onceLetter(key: Letter): string {
  const before = answers(letterMap.has(key), letterMap.get(key), letterSet.has(key), letterMap.size, letterSet.size);
  letterMap.set(key, letterMap.size);
  letterSet.add(key);
  return `${describe(key)}: ${before} -> ${answers(letterMap.has(key), letterMap.get(key), letterSet.has(key), letterMap.size, letterSet.size)}`;
}

const valueMap = new Map<unknown, number>();
const valueSet = new Set<unknown>();
function onceValue(key: unknown): string {
  const before = answers(valueMap.has(key), valueMap.get(key), valueSet.has(key), valueMap.size, valueSet.size);
  valueMap.set(key, valueMap.size);
  valueSet.add(key);
  return `${describe(key)}: ${before} -> ${answers(valueMap.has(key), valueMap.get(key), valueSet.has(key), valueMap.size, valueSet.size)}`;
}

console.log([onceNumber(numbers[0]), onceNumber(numbers[1]), onceNumber(numbers[2]), onceNumber(numbers[3]), onceNumber(numbers[4]), onceNumber(numbers[5]), onceNumber(numbers[6]), onceNumber(numbers[7])].join("\n"));
console.log([onceOptionalNumber(optionalNumbers[0]), onceOptionalNumber(optionalNumbers[1]), onceOptionalNumber(optionalNumbers[2]), onceOptionalNumber(optionalNumbers[3]), onceOptionalNumber(optionalNumbers[4]), onceOptionalNumber(optionalNumbers[5]), onceOptionalNumber(optionalNumbers[6]), onceOptionalNumber(optionalNumbers[7])].join("\n"));
console.log([onceString(strings[0]), onceString(strings[1]), onceString(strings[2]), onceString(strings[3]), onceString(strings[4]), onceString(strings[5]), onceString(strings[6]), onceString(strings[7])].join("\n"));
console.log([onceLetter(letters[0]), onceLetter(letters[1]), onceLetter(letters[2]), onceLetter(letters[3])].join("\n"));
console.log([onceValue(values[0]), onceValue(values[1]), onceValue(values[2]), onceValue(values[3]), onceValue(values[4]), onceValue(values[5]), onceValue(values[6]), onceValue(values[7]), onceValue(values[8])].join("\n"));
console.log([onceValue(values[9]), onceValue(values[10]), onceValue(values[11]), onceValue(values[12]), onceValue(values[13]), onceValue(values[14]), onceValue(values[15]), onceValue(values[16])].join("\n"));

const minusZero: number = half(-0);
const one: number = half(2);
const topMap = new Map<number, string>();
const topSet = new Set<number>();
console.log(topMap.size, topSet.size, topMap.has(minusZero), topMap.get(one), topSet.has(notANumber));
topMap.set(minusZero, "zero").set(one, "one").set(notANumber, "not a number");
topSet.add(minusZero).add(one).add(-notANumber);
console.log(topMap.has(0), topMap.get(0), topMap.has(1), topMap.get(1), topMap.has(-notANumber), topMap.get(-notANumber), topMap.size);
console.log(topSet.has(0), topSet.has(1), topSet.has(notANumber), topSet.has(0.5), topSet.size);
console.log([...topMap.keys()].map(describe).join(), [...topSet].map(describe).join());

const letter: Letter = "a";
const whole: number = doubles[1];
console.log(computedStrings.has(letter), computedStrings.get(letter), computedMembers.has(letter), computedStrings.size, computedMembers.size);
console.log((letterMap as Map<string, number>).get(computedB), (letterSet as Set<string>).has(computedB), (letterSet as Set<string>).has("c"));
console.log(wholeNumbers.has(whole), wholeNumbers.get(whole), wholeMembers.has(whole));
