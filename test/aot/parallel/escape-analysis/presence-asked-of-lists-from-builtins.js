// A list that a built-in has just made is asked whether it has an element, and the answer is printed. The compiler may leave such a list unbuilt where the program only reads elements.
const letters = ["a", "b", "c", "d", "e", "f"];
const numbers = [1, 2, 3, 4, 5, 6];
const sparse = ["a", , "c", , "e", "f"];
const text = "a,b,c,d,e,f";
const has = (list, key) => key in list;
const makers = {
  splice: (from, count) => from.slice().splice(0, count),
  slice: (from, count) => from.slice(0, count),
  concat: (from, count) => from.slice(0, count).concat([]),
  filter: (from, count) => from.filter((_, index) => index < count),
  map: (from, count) => from.slice(0, count).map(item => item),
  flat: (from, count) => [from.slice(0, count)].flat(),
  toSpliced: (from, count) => from.toSpliced(count),
  from: (from, count) => Array.from(from.slice(0, count)),
  of: (from, count) => (count === 0 ? Array.of() : count === 1 ? Array.of(from[0]) : Array.of(from[0], from[1])),
  split: (from, count) => text.split(",", count),
  match: (from, count) => /(a)?(z)?(b)?/.exec(count ? "ab" : "z"),
};
const questions = {
  in: list => 1 in list,
  inFar: list => 6 in list,
  inZero: list => 0 in list,
  inHelper: list => has(list, 1),
  reflectHas: list => Reflect.has(list, 1),
  hasOwn: list => Object.hasOwn(list, 1),
  hasOwnProperty: list => list.hasOwnProperty(1),
  forIn: list => { let keys = ""; for (const key in list) keys += key; return keys; },
  keys: list => Object.keys(list).join(""),
  condition: list => { if (1 in list) return "in " + list[1]; return "out " + list[1]; },
  readThenIn: list => list[1] + " " + (1 in list),
  inThenRead: list => (1 in list) + " " + list[1],
  ternary: list => (2 in list ? list[2] : "none"),
  forEach: list => { let seen = ""; list.forEach((_, index) => { seen += index; }); return seen; },
  indexOf: list => list.indexOf(undefined) + " " + list.includes(undefined),
  lengthAndJoin: list => list.length + " " + list.join(""),
  read: list => list[1],
};
for (const maker in makers) for (const question in questions) {
  const answers = [];
  for (const from of [letters, numbers, sparse]) for (let count = 0; count < 3; count++) answers.push(questions[question](makers[maker](from, count)));
  console.log(maker, question, answers.join(" | "));
}

// The same written out, so that the call and the question stand in one function.
const inLoop = [];
for (let count = 0; count < 3; count++) inLoop.push(1 in letters.slice().splice(0, count));
console.log(inLoop.join(" "));
const heldFirst = [];
for (let count = 0; count < 3; count++) { const taken = letters.slice().splice(0, count); heldFirst.push(1 in taken, 6 in taken, taken.length); }
console.log(heldFirst.join(" "));
function asked(count) { return 1 in letters.slice().splice(0, count); }
console.log(asked(0), asked(1), asked(2));
function branched(count) { const taken = letters.slice().splice(0, count); if (1 in taken) return "in " + taken[1]; return "out " + taken[1]; }
console.log(branched(0), branched(1), branched(2));
function group(pattern, subject) { const found = pattern.exec(subject); return found && (2 in found) + " " + found[2] + " " + Reflect.has(found, 9); }
console.log(group(/(a)(b)?/, "a"), group(/(a)(b)?/, "ab"), group(/(a)(b)?/, "z"));
function part(subject) { const parts = subject.split(","); return (1 in parts) + " " + parts[1]; }
console.log(part("a"), part("a,b"), part(""));
for (let count = 0; count < 3; count++) console.log(1 in letters.slice(0, count), 1 in letters.toSpliced(count), 1 in letters.filter((_, index) => index < count), 1 in text.split(",", count), Reflect.has(letters.slice().splice(0, count), 1));
