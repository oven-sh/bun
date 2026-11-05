// A RegExp literal that a constant of a module holds is made by the first read of the constant. It is one object from then on: it keeps its lastIndex and its properties, and every reader finds the same one.
// TODO: the build counts 2: STATISTIC: RegExpsDeferredInVariables >= 3
const words = /[a-z]+/g;
const sticky = /ab/y;
const plain = /(\d+)-(\d+)/;
const marked = /x/;
const neverRead = /never/;
const readAtStart = /start/;

const hidden: any = (value: unknown) => value;

function nextWord(text: string): string {
  const match = words.exec(text);
  return match ? match[0] + "@" + words.lastIndex : "none@" + words.lastIndex;
}

function otherReaderOfWords(): RegExp {
  return words;
}

function stickyAt(text: string, index: number): string {
  sticky.lastIndex = index;
  return sticky.test(text) + "@" + sticky.lastIndex;
}

function parts(text: string): string {
  const match = plain.exec(text);
  return match ? match[1] + "|" + match[2] : "none";
}

function mark(): void {
  hidden(marked).note = "kept";
}

function readMark(): string {
  return String(hidden(marked).note) + " " + marked.source + " " + marked.flags;
}

console.log(readAtStart.test("the start"));
console.log(nextWord("one two three"), nextWord("one two three"), nextWord("one two three"), nextWord("one two three"), nextWord("one two three"));
console.log(otherReaderOfWords() === words, otherReaderOfWords() === otherReaderOfWords(), hidden(words) === otherReaderOfWords());
console.log(stickyAt("xxab", 2), stickyAt("xxab", 1), stickyAt("abab", 0));
console.log(parts("10-20"), parts("nothing"), "7-8 9-10".replace(plain, "$2-$1"));
console.log(readMark());
mark();
console.log(readMark());
console.log(Object.getPrototypeOf(plain) === RegExp.prototype, plain instanceof RegExp, String(plain), typeof plain);
