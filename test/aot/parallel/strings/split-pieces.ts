// What a program reads off the list of split: its first pieces, its last piece, its length, and the list of two texts that the build knows.
export {};

const texts = ["", ",", "a", "a,b", "a,b,c", ",a,", "a,,b", "aa", "aaa", "aaaa", "aaaaa", "abab", "ababa", "é,→,😀", "x=1=2", "=", "k=", "a=b,c=d"];

const show = (value: unknown) => JSON.stringify(value) ?? "undefined";

const lastPieces: Record<string, (text: string) => unknown> = {
  pop: text => text.split(",").pop(),
  "at(-1)": text => text.split(",").at(-1),
  "[length - 1]": text => {
    const list = text.split(",");
    return list[list.length - 1];
  },
  "two units": text => text.split("ab").pop(),
  "overlaps itself": text => text.split("aa").pop(),
  "overlaps itself at one unit": text => text.split("aba").at(-1),
  "not Latin-1": text => text.split("→").pop(),
};

const firstPieces: Record<string, (text: string) => unknown> = {
  "[0]": text => text.split(",")[0],
  shift: text => text.split(",").shift(),
  "at(0)": text => text.split(",").at(0),
  "overlaps itself": text => text.split("aa")[0],
  "[2]": text => text.split(",")[2],
  "[0] [1] [2]": text => {
    const list = text.split(",");
    return [list[0], list[1], list[2]];
  },
  "[1] twice": text => {
    const list = text.split("aa");
    return [list[1], list[1]];
  },
};

const patterns: Record<string, (text: string) => unknown> = {
  one: text => {
    const [only] = text.split(",");
    return [only];
  },
  two: text => {
    const [key, value] = text.split("=");
    return [key, value];
  },
  three: text => {
    const [a, b, c] = text.split(",");
    return [a, b, c];
  },
  "overlaps itself": text => {
    const [a, b, c] = text.split("aa");
    return [a, b, c];
  },
  "with a default": text => {
    const [key, value = "none"] = text.split("=");
    return [key, value];
  },
  "with a gap": text => {
    const [, second] = text.split(",");
    return [second];
  },
  "with a rest": text => {
    const [head, ...rest] = text.split(",");
    return [head, rest];
  },
  assigned: text => {
    const into: { a?: string; b?: string } = {};
    [into.b, into.a] = text.split(",");
    return into;
  },
  nested: text => {
    const [first, second = ""] = text.split(",");
    const [key, value] = first.split("=");
    const [otherKey, otherValue] = second.split("=");
    return [key, value, otherKey, otherValue];
  },
};

const lengths: Record<string, (text: string) => unknown> = {
  alone: text => text.split(",").length,
  "overlaps itself": text => text.split("aa").length,
  "not Latin-1": text => text.split("→").length,
  "decides which pieces are read": text => {
    const list = text.split("=");
    return list.length === 2 ? [list[0], list[1]] : list.length;
  },
  "beside pieces": text => {
    const list = text.split(",");
    return [list[0], list[2], list.length, list.length];
  },
  "bounds a loop": text => {
    const list = text.split(",");
    let seen = "";
    for (let turn = 0; turn < list.length; turn++) seen += list[0] + turn;
    return seen;
  },
  "beside the list itself": text => {
    const list = text.split(",");
    return list.length > 1 ? list : list[0];
  },
  "beside an index that is computed": text => {
    const list = text.split(",");
    return [list.length, list[list.length >> 1]];
  },
  "under a handler": text => {
    const list = text.split(",");
    try {
      if (list.length > 2) throw new Error(list[1]);
      return list.length;
    } catch (error) {
      return [(error as Error).message, list.length, list[0]];
    }
  },
};

function lengthOfEither(text: string, takesComma: boolean) {
  const separator = takesComma ? "," : "aa";
  const list = text.split(separator);
  return [list.length, list[1]];
}

function lengthWhereSeparatorMayBeEmpty(text: string, isEmpty: boolean) {
  const separator = isEmpty ? "" : ",";
  return text.split(separator).length;
}

function lastOfEither(text: string, takesComma: boolean) {
  const separator = takesComma ? "," : "aa";
  return text.split(separator).pop();
}

function firstTwoOfEither(text: string, takesComma: boolean) {
  const separator = takesComma ? "," : "aa";
  const [first, second] = text.split(separator);
  return [first, second];
}

function lastWhereSeparatorMayBeEmpty(text: string, isEmpty: boolean) {
  const separator = isEmpty ? "" : ",";
  return text.split(separator).pop();
}

function firstTwoWhereSeparatorMayBeEmpty(text: string, isEmpty: boolean) {
  const separator = isEmpty ? "" : ",";
  const [first, second] = text.split(separator);
  return [first, second];
}

for (const [title, cases] of Object.entries({ lastPieces, firstPieces, patterns, lengths })) {
  for (const [name, read] of Object.entries(cases)) {
    console.log(title, name, texts.map(text => show(read(text))).join(" "));
  }
}
for (const flag of [true, false]) {
  console.log("last of either", flag, texts.map(text => show(lastOfEither(text, flag))).join(" "));
  console.log("first two of either", flag, texts.map(text => show(firstTwoOfEither(text, flag))).join(" "));
  console.log("last, may be empty", flag, texts.map(text => show(lastWhereSeparatorMayBeEmpty(text, flag))).join(" "));
  console.log("first two, may be empty", flag, texts.map(text => show(firstTwoWhereSeparatorMayBeEmpty(text, flag))).join(" "));
  console.log("length of either", flag, texts.map(text => show(lengthOfEither(text, flag))).join(" "));
  console.log("length, may be empty", flag, texts.map(text => show(lengthWhereSeparatorMayBeEmpty(text, flag))).join(" "));
}

async function acrossAnAwait(text: string) {
  const [first = await Promise.resolve("no first"), second = await Promise.resolve("no second"), third] = text.split(",");
  return [first, second, third];
}

function* acrossAYield(text: string) {
  const [first, second = yield first, third] = text.split(",");
  return [first, second, third];
}

async function lengthAcrossAnAwait(text: string) {
  const list = text.split(",");
  const first = await Promise.resolve(list[0]);
  return [first, list.length, list[1]];
}

for (const text of texts) {
  const steps = acrossAYield(text);
  const step = steps.next();
  console.log("suspended", show(await acrossAnAwait(text)), show(step.done ? step.value : steps.next("sent").value), show(await lengthAcrossAnAwait(text)));
}

const words = () => "red,green,blue".split(",");
const cut = (text: string, separator: string) => text.split(separator);

const changed = words();
changed.push("black");
changed[0] = "white";
console.log(show(changed), show(words()), words() === words(), words().length);
console.log(show("".split(",")), show(",".split(",")), show("a".split("a")), show("aaa".split("aa")), show("abc".split("")), show("".split("")));
console.log(show("é,→,😀".split(",")), show("é→é".split("→")), show("😀".split("\ud83d")), show("😀".split("\ude00")), show("a\ud83db".split("\ud83d")));
console.log(show(cut("one two", " ")), show(cut("aaaa", "aa")), show(cut("no", "yes")), show(cut("x", "")), show(cut("😀😀", "\ude00\ud83d")));
console.log(show("0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33".split(",").length));
