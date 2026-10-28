// Five calls of sort and toSorted in one program, each with a comparator of its own, over fractions, whole numbers, words and records. Two of the comparators are not consistent: one never answers "equal", one is not transitive. The order of the elements and the number of comparisons are plain Bun's.
// The library has one sort for all five. sort-comparators-are-inlined.test.ts builds this program and reads the generated code: each call has its own copy of the sort, with its comparator inside.
interface Entry {
  rank: number;
  id: number;
}

let seed = 20261019;
function next(): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed;
}

const kinds = ["random", "few values", "rising", "falling", "teeth", "two runs that interleave", "two runs apart", "nearly in order"];
const lengths = [0, 1, 2, 3, 7, 8, 9, 16, 33, 63, 64, 65, 66, 100, 129, 200, 500, 1100];

function make(kind: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    switch (kind) {
      case 0:
        out.push(next() % 1000);
        break;
      case 1:
        out.push(next() % 4);
        break;
      case 2:
        out.push(i);
        break;
      case 3:
        out.push(n - i);
        break;
      case 4:
        out.push(i % 17);
        break;
      case 5:
        out.push(i < n / 2 ? i * 2 : (i - (n >> 1)) * 2 + 1);
        break;
      case 6:
        out.push(i < n / 2 ? i + n : i);
        break;
      default:
        out.push(next() % 20 ? i : next() % n);
    }
  }
  return out;
}

function copyOf(keys: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < keys.length; i++) out.push(keys[i]);
  return out;
}

function fractionsOf(keys: number[], fraction: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < keys.length; i++) out.push(keys[i] + fraction);
  return out;
}

const syllables = ["ba", "be", "b", "", "zo", "Zo", "\u00e9", "\u4e16"];
function wordsOf(keys: number[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < keys.length; i++) out.push(syllables[keys[i] % 8] + syllables[(keys[i] >> 3) % 8] + (keys[i] % 13));
  return out;
}

function entriesOf(keys: number[]): Entry[] {
  const out: Entry[] = [];
  for (let i = 0; i < keys.length; i++) out.push({ rank: keys[i], id: i });
  return out;
}

function orderFractions(values: number[]): number[] {
  return values.sort((a, b) => a - b);
}

function orderWholeNumbersDownward(values: number[]): number[] {
  return values.sort((a: number, b: number): number => (a < b ? 1 : -1));
}

function orderWords(words: string[]): string[] {
  return words.sort((a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0));
}

function orderEntries(entries: Entry[]): Entry[] {
  return entries.toSorted((a: Entry, b: Entry): number => a.rank - b.rank);
}

let comparisons = 0;
function orderByRemainders(values: number[]): number[] {
  return values.sort((a, b) => {
    comparisons++;
    return (a % 7) - (b % 5);
  });
}

function mixNumbers(sum: number, values: number[]): number {
  for (let i = 0; i < values.length; i++) sum = (Math.imul(sum, 31) + values[i] * 4) | 0;
  return sum;
}

function mixWords(sum: number, words: string[]): number {
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    for (let k = 0; k < word.length; k++) sum = (Math.imul(sum, 31) + word.charCodeAt(k)) | 0;
    sum = (Math.imul(sum, 31) + 7) | 0;
  }
  return sum;
}

function mixEntries(sum: number, entries: Entry[]): number {
  for (let i = 0; i < entries.length; i++) sum = (Math.imul(sum, 31) + entries[i].id) | 0;
  return sum;
}

function textOfEntries(entries: Entry[]): string {
  let text = "";
  for (let i = 0; i < entries.length; i++) text += (i ? " " : "") + entries[i].rank + ":" + entries[i].id;
  return text;
}

const lines: string[] = [];
let sortReturnsItsReceiver = true;
let toSortedMakesAnArray = true;
for (let kind = 0; kind < kinds.length; kind++) {
  let fractions = 0;
  let wholeNumbers = 0;
  let words = 0;
  let entries = 0;
  let remainders = 0;
  comparisons = 0;
  for (let at = 0; at < lengths.length; at++) {
    const keys = make(kind, lengths[at]);
    const halves = fractionsOf(keys, 0.5);
    const whole = copyOf(keys);
    const texts = wordsOf(keys);
    const records = entriesOf(keys);
    const quarters = fractionsOf(keys, 0.25);

    sortReturnsItsReceiver = orderFractions(halves) === halves && sortReturnsItsReceiver;
    sortReturnsItsReceiver = orderWholeNumbersDownward(whole) === whole && sortReturnsItsReceiver;
    sortReturnsItsReceiver = orderWords(texts) === texts && sortReturnsItsReceiver;
    const ordered = orderEntries(records);
    toSortedMakesAnArray = ordered !== records && toSortedMakesAnArray;
    sortReturnsItsReceiver = orderByRemainders(quarters) === quarters && sortReturnsItsReceiver;

    fractions = mixNumbers(fractions, halves);
    wholeNumbers = mixNumbers(wholeNumbers, whole);
    words = mixWords(words, texts);
    entries = mixEntries(mixEntries(entries, ordered), records);
    remainders = mixNumbers(remainders, quarters);

    if (lengths[at] === 9) {
      lines.push(kinds[kind] + ", nine fractions: " + halves.join(" "));
      lines.push(kinds[kind] + ", nine whole numbers: " + whole.join(" "));
      lines.push(kinds[kind] + ", nine words: " + texts.join(" "));
      lines.push(kinds[kind] + ", nine records: " + textOfEntries(ordered));
      lines.push(kinds[kind] + ", nine fractions by their remainders: " + quarters.join(" "));
    }
  }
  lines.push(kinds[kind] + ": " + fractions + " " + wholeNumbers + " " + words + " " + entries + " " + remainders + " after " + comparisons + " comparisons");
}
lines.push("sort returns its receiver: " + sortReturnsItsReceiver);
lines.push("toSorted makes an array: " + toSortedMakesAnArray);
console.log(lines.join("\n"));
