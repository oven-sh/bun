function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

async function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(await run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

const seen = [];

function sizeOne(text) {
  const result = text.length;
  seen.push(show(result));
  return result;
}

function sizeTwo(text) {
  const result = text.length;
  seen.push(show(result));
  return result;
}

function sizeThree(text) {
  const result = text.length;
  seen.push(show(result));
  return result;
}

function sizeFour(text) {
  const result = text.length;
  seen.push(show(result));
  return result;
}

function sizeFive(text) {
  const result = text.length;
  seen.push(show(result));
  return result;
}

function sizeSix(text) {
  const result = text.length;
  seen.push(show(result));
  return result;
}

function sizeSeven(text) {
  const result = text.length;
  seen.push(show(result));
  return result;
}

function sizeEight(text) {
  const result = text.length;
  seen.push(show(result));
  return result;
}

function firstNine(list) {
  const result = list[0];
  seen.push(show(result));
  return result;
}

function firstTen(list) {
  const result = list[0];
  seen.push(show(result));
  return result;
}

function firstEleven(list) {
  const result = list[0];
  seen.push(show(result));
  return result;
}

function halfTwelve(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function sizeThirteen(text) {
  const result = text.length;
  seen.push(show(result));
  return result;
}

function sizeFourteen(text) {
  const result = text.length;
  seen.push(show(result));
  return result;
}

function halfFifteen(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfSixteen(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function lowSeventeen(n) {
  const result = n & 3;
  seen.push(show(result));
  return result;
}

function lowEighteen(n) {
  const result = n & 3;
  seen.push(show(result));
  return result;
}

function halfNineteen(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfTwenty(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

async function main() {
  await attempt("a group that took no part, in replace", () => "ab".replace(/(x)?a/, (match, group) => sizeOne(group)));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(sizeOne("ab")), show(sizeOne("")), show(sizeOne("xyz")), show(sizeOne(`a${1}`)), seen.splice(0).length);
  console.log("honest", show(sizeTwo("ab")), show(sizeTwo("")), show(sizeTwo("xyz")), show(sizeTwo(`a${1}`)), seen.splice(0).length);
  await attempt("the callback itself gets the match", () => "ab".replace(/(x)?a/, sizeTwo));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(sizeTwo("ab")), show(sizeTwo("")), show(sizeTwo("xyz")), show(sizeTwo(`a${1}`)), seen.splice(0).length);
  await attempt("a group that took no part, in replaceAll", () => "abab".replaceAll(/(x)?a/g, (match, group) => sizeThree(group)));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(sizeThree("ab")), show(sizeThree("")), show(sizeThree("xyz")), show(sizeThree(`a${1}`)), seen.splice(0).length);
  console.log("honest", show(sizeFour("ab")), show(sizeFour("")), show(sizeFour("xyz")), show(sizeFour(`a${1}`)), seen.splice(0).length);
  await attempt("a group that took no part, in exec", () => sizeFour(/(x)?a/.exec("ab")[1]));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(sizeFour("ab")), show(sizeFour("")), show(sizeFour("xyz")), show(sizeFour(`a${1}`)), seen.splice(0).length);
  await attempt("a group that took no part, in match", () => sizeFive("ab".match(/(x)?a/)[1]));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(sizeFive("ab")), show(sizeFive("")), show(sizeFive("xyz")), show(sizeFive(`a${1}`)), seen.splice(0).length);
  console.log("honest", show(sizeSix("ab")), show(sizeSix("")), show(sizeSix("xyz")), show(sizeSix(`a${1}`)), seen.splice(0).length);
  await attempt("a group that took no part, in matchAll", () => [..."ab".matchAll(/(x)?a/g)].map(found => sizeSix(found[1])));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(sizeSix("ab")), show(sizeSix("")), show(sizeSix("xyz")), show(sizeSix(`a${1}`)), seen.splice(0).length);
  await attempt("a group that took no part, in split", () => "ab".split(/(x)?b/).map(piece => sizeSeven(piece)));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(sizeSeven("ab")), show(sizeSeven("")), show(sizeSeven("xyz")), show(sizeSeven(`a${1}`)), seen.splice(0).length);
  console.log("honest", show(sizeEight("ab")), show(sizeEight("")), show(sizeEight("xyz")), show(sizeEight(`a${1}`)), seen.splice(0).length);
  await attempt("a named group that took no part", () => sizeEight(/(?<name>x)?a/.exec("ab").groups.name));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(sizeEight("ab")), show(sizeEight("")), show(sizeEight("xyz")), show(sizeEight(`a${1}`)), seen.splice(0).length);
  await attempt("no match at all", () => firstNine("ab".match(/x/)));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(firstNine([1, 2])), show(firstNine([])), show(firstNine(new Array(4, 5))), show(firstNine([0.5])), seen.splice(0).length);
  console.log("honest", show(firstTen([1, 2])), show(firstTen([])), show(firstTen(new Array(4, 5))), show(firstTen([0.5])), seen.splice(0).length);
  await attempt("no match at all, in exec", () => firstTen(/x/.exec("ab")));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(firstTen([1, 2])), show(firstTen([])), show(firstTen(new Array(4, 5))), show(firstTen([0.5])), seen.splice(0).length);
  await attempt("the groups of an expression without names", () => firstEleven(/a/.exec("ab").groups));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(firstEleven([1, 2])), show(firstEleven([])), show(firstEleven(new Array(4, 5))), show(firstEleven([0.5])), seen.splice(0).length);
  console.log("honest", show(halfTwelve(4)), show(halfTwelve(3)), show(halfTwelve(0.5)), show(halfTwelve(-8)), seen.splice(0).length);
  await attempt("the offset that replace hands over comes after the groups", () => "ab".replace(/(b)/, (match, offset) => halfTwelve(offset)));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfTwelve(4)), show(halfTwelve(3)), show(halfTwelve(0.5)), show(halfTwelve(-8)), seen.splice(0).length);
  await attempt("at past the end", () => sizeThirteen("ab".at(5)));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(sizeThirteen("ab")), show(sizeThirteen("")), show(sizeThirteen("xyz")), show(sizeThirteen(`a${1}`)), seen.splice(0).length);
  console.log("honest", show(sizeFourteen("ab")), show(sizeFourteen("")), show(sizeFourteen("xyz")), show(sizeFourteen(`a${1}`)), seen.splice(0).length);
  await attempt("an index past the end", () => sizeFourteen("ab"[5]));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(sizeFourteen("ab")), show(sizeFourteen("")), show(sizeFourteen("xyz")), show(sizeFourteen(`a${1}`)), seen.splice(0).length);
  await attempt("charCodeAt past the end", () => halfFifteen("ab".charCodeAt(5)));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfFifteen(4)), show(halfFifteen(3)), show(halfFifteen(0.5)), show(halfFifteen(-8)), seen.splice(0).length);
  console.log("honest", show(halfSixteen(4)), show(halfSixteen(3)), show(halfSixteen(0.5)), show(halfSixteen(-8)), seen.splice(0).length);
  await attempt("codePointAt past the end", () => halfSixteen("ab".codePointAt(5)));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfSixteen(4)), show(halfSixteen(3)), show(halfSixteen(0.5)), show(halfSixteen(-8)), seen.splice(0).length);
  await attempt("charCodeAt past the end, bits", () => lowSeventeen("ab".charCodeAt(5)));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(lowSeventeen(4)), show(lowSeventeen(3)), show(lowSeventeen(7)), show(lowSeventeen(-1)), seen.splice(0).length);
  console.log("honest", show(lowEighteen(4)), show(lowEighteen(3)), show(lowEighteen(7)), show(lowEighteen(-1)), seen.splice(0).length);
  await attempt("codePointAt past the end, bits", () => lowEighteen("ab".codePointAt(5)));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(lowEighteen(4)), show(lowEighteen(3)), show(lowEighteen(7)), show(lowEighteen(-1)), seen.splice(0).length);
  await attempt("indexOf of what is not there", () => halfNineteen("ab".indexOf("x")));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfNineteen(4)), show(halfNineteen(3)), show(halfNineteen(0.5)), show(halfNineteen(-8)), seen.splice(0).length);
  console.log("honest", show(halfTwenty(4)), show(halfTwenty(3)), show(halfTwenty(0.5)), show(halfTwenty(-8)), seen.splice(0).length);
  await attempt("parseInt of a word", () => halfTwenty(parseInt("word")));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfTwenty(4)), show(halfTwenty(3)), show(halfTwenty(0.5)), show(halfTwenty(-8)), seen.splice(0).length);
}

main();
