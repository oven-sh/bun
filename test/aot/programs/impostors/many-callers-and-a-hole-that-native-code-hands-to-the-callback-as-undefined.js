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

function halfOne(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfTwo(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfThree(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfFour(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfFive(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfSix(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfSeven(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfEight(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfNine(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfTen(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfEleven(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfTwelve(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfThirteen(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfFourteen(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfFifteen(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function lowSixteen(n) {
  const result = n & 3;
  seen.push(show(result));
  return result;
}

function lowSeventeen(n) {
  const result = n & 3;
  seen.push(show(result));
  return result;
}

function sizeEighteen(text) {
  const result = text.length;
  seen.push(show(result));
  return result;
}

function sizeNineteen(text) {
  const result = text.length;
  seen.push(show(result));
  return result;
}

function firstTwenty(list) {
  const result = list[0];
  seen.push(show(result));
  return result;
}

async function main() {
  await attempt("find over a hole", () => [0, , 3].find(halfOne));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfOne(4)), show(halfOne(3)), show(halfOne(0.5)), show(halfOne(-8)), seen.splice(0).length);
  console.log("honest", show(halfTwo(4)), show(halfTwo(3)), show(halfTwo(0.5)), show(halfTwo(-8)), seen.splice(0).length);
  await attempt("findIndex over a hole", () => [0, , 3].findIndex(halfTwo));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfTwo(4)), show(halfTwo(3)), show(halfTwo(0.5)), show(halfTwo(-8)), seen.splice(0).length);
  await attempt("findLast over a hole", () => [3, , 0].findLast(halfThree));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfThree(4)), show(halfThree(3)), show(halfThree(0.5)), show(halfThree(-8)), seen.splice(0).length);
  console.log("honest", show(halfFour(4)), show(halfFour(3)), show(halfFour(0.5)), show(halfFour(-8)), seen.splice(0).length);
  await attempt("findLastIndex over a hole", () => [3, , 0].findLastIndex(halfFour));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfFour(4)), show(halfFour(3)), show(halfFour(0.5)), show(halfFour(-8)), seen.splice(0).length);
  await attempt("map skips a hole", () => [1, , 3].map(halfFive));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfFive(4)), show(halfFive(3)), show(halfFive(0.5)), show(halfFive(-8)), seen.splice(0).length);
  console.log("honest", show(halfSix(4)), show(halfSix(3)), show(halfSix(0.5)), show(halfSix(-8)), seen.splice(0).length);
  await attempt("forEach skips a hole", () => [1, , 3].forEach(halfSix));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfSix(4)), show(halfSix(3)), show(halfSix(0.5)), show(halfSix(-8)), seen.splice(0).length);
  await attempt("Array.from over a hole", () => Array.from([1, , 3], halfSeven));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfSeven(4)), show(halfSeven(3)), show(halfSeven(0.5)), show(halfSeven(-8)), seen.splice(0).length);
  console.log("honest", show(halfEight(4)), show(halfEight(3)), show(halfEight(0.5)), show(halfEight(-8)), seen.splice(0).length);
  await attempt("Array.from over a length alone", () => Array.from({ length: 2 }, halfEight));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfEight(4)), show(halfEight(3)), show(halfEight(0.5)), show(halfEight(-8)), seen.splice(0).length);
  await attempt("the map of an iterator over a hole", () => [1, , 3].values().map(halfNine).toArray());
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfNine(4)), show(halfNine(3)), show(halfNine(0.5)), show(halfNine(-8)), seen.splice(0).length);
  console.log("honest", show(halfTen(4)), show(halfTen(3)), show(halfTen(0.5)), show(halfTen(-8)), seen.splice(0).length);
  await attempt("a spread of a hole into the arguments", () => [halfTen(...[, 1]), halfTen(...new Array(1))]);
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfTen(4)), show(halfTen(3)), show(halfTen(0.5)), show(halfTen(-8)), seen.splice(0).length);
  await attempt("apply with a hole", () => halfEleven.apply(null, [, 1]));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfEleven(4)), show(halfEleven(3)), show(halfEleven(0.5)), show(halfEleven(-8)), seen.splice(0).length);
  console.log("honest", show(halfTwelve(4)), show(halfTwelve(3)), show(halfTwelve(0.5)), show(halfTwelve(-8)), seen.splice(0).length);
  await attempt("apply with a length alone", () => halfTwelve.apply(null, { length: 1 }));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfTwelve(4)), show(halfTwelve(3)), show(halfTwelve(0.5)), show(halfTwelve(-8)), seen.splice(0).length);
  await attempt("find over new Array(2)", () => new Array(2).find(halfThirteen));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfThirteen(4)), show(halfThirteen(3)), show(halfThirteen(0.5)), show(halfThirteen(-8)), seen.splice(0).length);
  console.log("honest", show(halfFourteen(4)), show(halfFourteen(3)), show(halfFourteen(0.5)), show(halfFourteen(-8)), seen.splice(0).length);
  await attempt("find over an array whose length was raised", () => { const list = [0]; list.length = 2; return list.find(halfFourteen); });
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfFourteen(4)), show(halfFourteen(3)), show(halfFourteen(0.5)), show(halfFourteen(-8)), seen.splice(0).length);
  await attempt("find over an array with a deleted element", () => { const list = [1, 2]; delete list[0]; return list.find(halfFifteen); });
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfFifteen(4)), show(halfFifteen(3)), show(halfFifteen(0.5)), show(halfFifteen(-8)), seen.splice(0).length);
  console.log("honest", show(lowSixteen(4)), show(lowSixteen(3)), show(lowSixteen(7)), show(lowSixteen(-1)), seen.splice(0).length);
  await attempt("find over a hole, bits", () => [0, , 3].find(lowSixteen));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(lowSixteen(4)), show(lowSixteen(3)), show(lowSixteen(7)), show(lowSixteen(-1)), seen.splice(0).length);
  await attempt("Array.from over a length alone, bits", () => Array.from({ length: 2 }, lowSeventeen));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(lowSeventeen(4)), show(lowSeventeen(3)), show(lowSeventeen(7)), show(lowSeventeen(-1)), seen.splice(0).length);
  console.log("honest", show(sizeEighteen("ab")), show(sizeEighteen("")), show(sizeEighteen("xyz")), show(sizeEighteen(`a${1}`)), seen.splice(0).length);
  await attempt("find over a hole among strings", () => ["", , "c"].find(sizeEighteen));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(sizeEighteen("ab")), show(sizeEighteen("")), show(sizeEighteen("xyz")), show(sizeEighteen(`a${1}`)), seen.splice(0).length);
  await attempt("Array.from over a hole among strings", () => Array.from(["a", , "c"], sizeNineteen));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(sizeNineteen("ab")), show(sizeNineteen("")), show(sizeNineteen("xyz")), show(sizeNineteen(`a${1}`)), seen.splice(0).length);
  console.log("honest", show(firstTwenty([1, 2])), show(firstTwenty([])), show(firstTwenty(new Array(4, 5))), show(firstTwenty([0.5])), seen.splice(0).length);
  await attempt("find over a hole among arrays", () => [[0], , [3]].find(firstTwenty));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(firstTwenty([1, 2])), show(firstTwenty([])), show(firstTwenty(new Array(4, 5))), show(firstTwenty([0.5])), seen.splice(0).length);
}

main();
