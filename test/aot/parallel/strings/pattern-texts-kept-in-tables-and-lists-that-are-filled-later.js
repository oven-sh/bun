// The text of a pattern goes through an object or a list that is empty when it is made and filled afterwards, by other functions. The build still knows the text, so the pattern's code is in the image.
// KNOWN registry [0-9]+
// KNOWN registry [a-z]+
// KNOWN registry ^(?:[0-9]+|[a-z]+)$
// KNOWN closure <[a-z]+>
// KNOWN closure ^<[a-z]+>\s*$
// KNOWN statements red|green|blue
// KNOWN method one|two
// KNOWN field ^item-\d+$
// KNOWN builder ^(?:x-y-z)$
// UNKNOWN ^year-1970$
// COUNTER: RegExpsCreatedWithoutRecord = 1

// A text is stored under a number that only the run knows, and the number under a name.
const numbers = {};
const texts = [];
const patterns = [];
let next = Date.now() % 7;
function register(name, text) {
  const number = next++;
  numbers[name] = number;
  texts[number] = text;
  patterns[number] = new RegExp(text);
}
register("DIGITS", "[0-9]+");
register("LETTERS", "[a-z]+");
register("EITHER", `^(?:${texts[numbers.DIGITS]}|${texts[numbers.LETTERS]})$`);

// The same, where the tables are variables of a function that closures share.
function makeRegistry() {
  const ids = {};
  const sources = [];
  let count = Date.now() % 5;
  return {
    define(name, source) {
      const id = count++;
      ids[name] = id;
      sources[id] = source;
    },
    compile(name) {
      return new RegExp(sources[ids[name]]);
    },
    sourceOf(name) {
      return sources[ids[name]];
    },
  };
}
const registry = makeRegistry();
registry.define("TAG", "<[a-z]+>");
registry.define("LINE", `^${registry.sourceOf("TAG")}\\s*$`);

// A list that statements append to.
const colors = [];
colors.push("red");
colors.push("green");
colors.push("blue");
const color = new RegExp(colors.join("|"));

// A list that a method appends to, on an object that is not handed on from call to call.
class Words {
  constructor() {
    this.words = [];
  }
  add(word) {
    this.words.push(word);
  }
  pattern() {
    return new RegExp(this.words.join("|"));
  }
}
const words = new Words();
words.add("one");
words.add("two");

// A field that the constructor stores.
class Prefixed {
  constructor(prefix) {
    this.prefix = prefix;
  }
  pattern() {
    return new RegExp("^" + this.prefix + "-\\d+$");
  }
}
const prefixed = new Prefixed("item");

// A text that a loop over a known object puts together, read behind the loop.
let joined = "";
for (const key in { x: 1, y: 2, z: 3 }) joined += (joined ? "-" : "") + key;
const built = new RegExp(`^(?:${joined})$`);

// What only the run knows stays unknown.
register("YEAR", `^year-${new Date(0).getUTCFullYear()}$`);

console.log(patterns[numbers.EITHER].source, patterns[numbers.EITHER].test("abc"), patterns[numbers.EITHER].test("a1"), patterns[numbers.DIGITS].test("7"));
console.log(registry.compile("TAG").source, registry.compile("LINE").source, registry.compile("LINE").test("<b>  "), registry.compile("LINE").test("<B>"));
console.log(color.source, color.test("a green b"), color.test("grey"));
console.log(words.pattern().source, words.pattern().test("a two"), words.pattern().test("three"));
console.log(prefixed.pattern().source, prefixed.pattern().test("item-12"), prefixed.pattern().test("item-"));
console.log(built.source, built.test("x-y-z"), built.test("x-y"));
console.log(patterns[numbers.YEAR].source, patterns[numbers.YEAR].test("year-1970"));
