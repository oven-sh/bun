// RegExp.prototype[Symbol.matchAll], [Symbol.split] and the iterator's next() store `lastIndex` into the matcher, which is what the species constructor of the
// program made: an instance of a compiled class whose field only ever holds a string as far as the program's own text says.
const made: Matcher[] = [];

class Matcher {
  lastIndex = "never a number";
  calls = 0;
  constructor(pattern: unknown, flags: unknown) {
    made.push(this);
  }
  exec(text: string): RegExpExecArray | null {
    this.calls++;
    if (this.calls > 2) return null;
    return Object.assign([""], { index: 0, input: text, groups: undefined }) as RegExpExecArray;
  }
}

function describe(matcher: Matcher): string {
  const value = matcher.lastIndex;
  return `${typeof value} ${value} ${value.length}`;
}

function patternWithSpecies(source: string, flags: string): RegExp {
  const pattern = new RegExp(source, flags);
  Object.defineProperty(pattern, "constructor", { value: { [Symbol.species]: Matcher } });
  return pattern;
}

const fresh = new Matcher(0, 0);
console.log("fresh", describe(fresh));

const pattern = patternWithSpecies("a", "g");
pattern.lastIndex = 2;
const iterator = pattern[Symbol.matchAll]("aaaa");
console.log("after matchAll", describe(made[1]));
iterator.next();
console.log("after next", describe(made[1]));

const pieces = patternWithSpecies("b", "")[Symbol.split]("abab");
console.log("after split", describe(made[2]), pieces.length);

let total = 0;
for (const matcher of made) total += matcher.lastIndex.length ?? -1;
console.log(total);
