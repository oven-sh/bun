// localeCompare without a locale, on every pair of a list that holds each kind of string and each place where two strings may first differ.
function order(a: string, b: string): number {
  return a.localeCompare(b);
}
function fresh(text: string): string {
  return JSON.parse(JSON.stringify(text));
}
const left = fresh("left half of a rope, ");
const right = fresh("right half of a rope");
const whole = fresh("the quick brown fox jumps over the lazy dog");

const words: string[] = [
  "", " ", "a", "A", "b", "B", "z", "Z", "0", "9", "10", "2", "_", "-", "~", "!", "a b", "a-b", "a_b", "ab", "aB", "Ab", "AB", "abc", "abd", "ABC", "ABD",
  "pear", "apple", "fig", "mango", "Pear", "APPLE", "apples", "applE", "apple pie", "apple-pie", "applepie",
  // one word and more: the first difference at each byte of the first and of the second word, in case alone, and none.
  "abcdefgh", "abcdefgH", "Abcdefgh", "abcdefgi", "abcdefhh", "abcdeggh", "abcdffgh", "abceefgh", "abddefgh", "accdefgh", "bbcdefgh", "abcdefg", "abcdefghi",
  "abcdefghijklmnop", "abcdefghijklmnoq", "abcdefghijklmnpp", "abcdefghijklmoop", "abcdefghijklnnop", "abcdefghijkmmnop", "abcdefghijllmnop", "abcdefghikklmnop", "abcdefghjjklmnop",
  "abcdefghijklmnoP", "abcdefghIjklmnop", "ABCDEFGHIJKLMNOP", "abcdefghijklmnopq", "abcdefghijklmno", "abcdefghijklmnop ", "abcdefghijklmnop\u0001", "abcdefghijklmnopé",
  "aBcdefghijklmnoq", "aBcdefghijklmnop", "abcdefghijklmnopqrstuvwx", "abcdefghijklmnopqrstuvwy", "abcdefghijklmnopqrstuvwxyz",
  // control characters have no weight.
  "\u0000", "\u0001", "a\u0001", "a\u0001b", "ab\u0001", "\u0001ab", "a\u0000b", "\t", "\n", "a\tb", "a\nb", "\u007f", "a\u007f", "a\u007fb", "abcdefg\u0001", "abcdefg\u0001h", "abcdefgh\u0001", "abcdefg\u0001ijklmnop",
  // Latin-1 beyond ASCII, alone, behind an equal part and inside an equal word.
  "é", "é", "e", "f", "café", "cafe", "cafes", "cafés", "ß", "ss", "æ", "ae", "Å", "å", "ÿ", " ", "abcéefgh", "abcéefgi", "abcéefghijklmnop", "abcdefghé", "abcdefghéa", "abcdefghéb", "abcdefgé", "abcdefgê",
  // 16-bit strings.
  "ሴ", "aሴ", "α", "β", "abcα", "abcdefghα", "😀", "a😀", "中", "文",
];
const made: string[] = [
  left + right, left + fresh("right half of a ropf"), fresh("left half of a rope, right half of a rope"), right + left,
  whole.slice(4, 9), whole.slice(10, 15), whole.slice(4, 9), whole.slice(0, 30), whole.slice(0, 31), whole.substring(16), fresh("quick"), fresh("brown"),
  fresh("a") + fresh(""), fresh("") + fresh(""), "x".repeat(40), "x".repeat(39) + "y", "x".repeat(41), "x".repeat(39) + "X", "x".repeat(20) + "é" + "x".repeat(19),
];
const all = words.concat(made);

// Before the first comparison the default collator is not made yet.
console.log("first", order("b", "a"), order("a", "b"), order("a", "a"));

let line: number[] = [];
let sum = 0;
for (let i = 0; i < all.length; i++) {
  line = [];
  for (let j = 0; j < all.length; j++) {
    const answer = order(all[i]!, all[j]!);
    line.push(answer);
    sum = (sum * 31 + answer + 2) | 0;
  }
  console.log(i, line.join(""));
}
console.log("sum", sum);

// A string with itself, with its copy, and the sign against the other way round.
let wrong = 0;
for (const a of all) {
  if (order(a, a) !== 0 || order(a, fresh(a)) !== 0) wrong++;
  for (const b of all) if (order(a, b) !== -order(b, a) && order(a, b) + order(b, a) !== 0) wrong++;
}
console.log("wrong", wrong);

console.log("sorted", JSON.stringify(words.slice().sort((a, b) => a.localeCompare(b))));
console.log("sorted made", JSON.stringify(made.slice().sort((a, b) => a.localeCompare(b)).map(text => text.length)));

// With a locale or options the call is another one.
console.log("locales", "a".localeCompare("B", "en"), "a".localeCompare("A", undefined, { sensitivity: "base" }), "ä".localeCompare("z", "de"), "ä".localeCompare("z", "sv"), "a".localeCompare("b", undefined));

// What is no string is converted first.
const anything = order as (a: unknown, b: unknown) => number;
console.log("converted", "1".localeCompare(1 as unknown as string), "undefined".localeCompare(undefined as unknown as string), "null".localeCompare(null as unknown as string), "a".localeCompare({ toString() { return "b"; } } as unknown as string));
try {
  console.log(anything(undefined, "a"));
} catch (error) {
  console.log("thrown", (error as Error).constructor.name);
}

let hot = 0;
const names = ["pear", "apple", "fig", "mango", "applesauce and pears", "applesauce and plums", "Apple", "apple"].map(fresh);
for (let i = 0; i < 200000; i++) hot = (hot + order(names[i & 7]!, names[(i * 5 + 1) & 7]!) + 2) | 0;
console.log("hot", hot);
