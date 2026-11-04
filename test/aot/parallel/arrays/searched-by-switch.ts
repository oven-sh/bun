// A list of constants that is searched, and a chain of `===`, become one switch: it answers as the comparisons one behind the other do.
function isMethod(x: unknown) {
  return ["get", "put", "post", "delete"].includes(x as string);
}
function isMethodOfText(s: string) {
  return ["get", "put", "post", "delete"].includes(s);
}
function placeOfMethod(x: unknown) {
  return ["get", "put", "get", "post"].indexOf(x as string);
}
function isDigit(x: unknown) {
  return [0, 1, 2, 3].includes(x as number);
}
function isDigitOfInteger(n: number) {
  return [3, 1, 2, 0].includes(n);
}
function placeOfNumber(x: unknown) {
  return [3, -0, 0, 7, 3, 2 ** 31, -1].indexOf(x as number);
}
function placeInMixed(x: unknown) {
  return ["a", "b", "c", 1, 2, 3, null, "d", "e", "f", "a"].indexOf(x as string);
}
function placeBesideVariable(x: unknown, y: unknown) {
  return [y, "a", "b", "c", y].indexOf(x);
}
function hasBesideVariable(x: unknown, y: unknown) {
  return [y, "a", "b", "c"].includes(x);
}
function placeOfCharacter(s: string, i: number) {
  return ["a", "bc", "", "d", "é", "e"].indexOf(s[i]);
}
function placeOfCharAt(s: string, i: number) {
  return ["a", "", "b", "c"].indexOf(s.charAt(i));
}
type Kind = "circle" | "square" | "line";
function placeOfKind(kind: Kind) {
  return ["circle", "square", "line"].indexOf(kind);
}
function isNamedType(x: unknown) {
  return ["string", "number", "boolean"].includes(typeof x);
}
function underHandler(x: unknown) {
  const seen = { step: 0 };
  try {
    seen.step = 1;
    if (["x", "y", "z"].includes(x as string)) seen.step = 2;
  } catch {
    seen.step = 3;
  }
  return seen.step;
}
function chain(t: unknown) {
  if (t === "get") return 1;
  else if (t === "put") return 2;
  else if (t === "get") return 3;
  else if (t === "post") return 4;
  else return 0;
}
function chainOfNumbers(n: unknown) {
  if (n === 1) return "one";
  if (n === 0) return "zero";
  if (n === 2) return "two";
  if (n === 1) return "again";
  return "none";
}
function either(t: unknown) {
  return t === "a" || t === "b" || t === "c" || t === 1 || t === 2 || t === 3;
}

const pieces = process.argv.length > 99 ? ["?"] : ["po", "st", "g", "e", "t"];
const texts = ["get", "put", "post", "delete", "ge", "gett", "", pieces[0] + pieces[1], pieces[2] + (pieces[3] + pieces[4]), "gеt"];
const values: unknown[] = [
  ...texts,
  new String("get"),
  "a", "b", "c", "d", "e", "f", "x", "z",
  0, -0, 1, 2, 3, 7, -1, 1.5, NaN, Infinity, 2 ** 31, 2 ** 53,
  1n, true, false, null, undefined, Symbol.iterator, {}, [], ["get"],
];

values.forEach((value, place) => {
  console.log(
    place,
    isMethod(value),
    placeOfMethod(value),
    isDigit(value),
    placeOfNumber(value),
    placeInMixed(value),
    placeBesideVariable(value, "b"),
    placeBesideVariable(value, value),
    hasBesideVariable(value, value),
    isNamedType(value),
    underHandler(value),
    chain(value),
    chainOfNumbers(value),
    either(value),
  );
});
for (const text of texts) console.log(JSON.stringify(text), isMethodOfText(text));
for (let n = -2; n < 6; n++) console.log(n, isDigitOfInteger(n));
for (const text of ["abcde", "", "éd", "dbc"]) {
  for (let i = -1; i < 6; i++) console.log(JSON.stringify(text), i, placeOfCharacter(text, i), placeOfCharAt(text, i));
}
for (const kind of ["circle", "square", "line"] as const) console.log(kind, placeOfKind(kind));
