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

function halfSixteen(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfSeventeen(n) {
  const result = n / 2;
  seen.push(show(result));
  return result;
}

function halfEighteen(n) {
  const result = n / 2;
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
  await attempt("reduce feeds the callback its own answer", () => [4, 2, 1].reduce((sum, n) => String(halfOne(sum)) + n));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfOne(4)), show(halfOne(3)), show(halfOne(0.5)), show(halfOne(-8)), seen.splice(0).length);
  console.log("honest", show(halfTwo(4)), show(halfTwo(3)), show(halfTwo(0.5)), show(halfTwo(-8)), seen.splice(0).length);
  await attempt("reduce hands the callback over directly", () => [4, "2", 1].reduce(halfTwo));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfTwo(4)), show(halfTwo(3)), show(halfTwo(0.5)), show(halfTwo(-8)), seen.splice(0).length);
  await attempt("reduceRight starts at the end", () => ["4", 2, 8].reduceRight(halfThree));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfThree(4)), show(halfThree(3)), show(halfThree(0.5)), show(halfThree(-8)), seen.splice(0).length);
  console.log("honest", show(halfFour(4)), show(halfFour(3)), show(halfFour(0.5)), show(halfFour(-8)), seen.splice(0).length);
  await attempt("then unwraps a thenable", () => Promise.resolve({ then: resolve => resolve("4") }).then(halfFour));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfFour(4)), show(halfFour(3)), show(halfFour(0.5)), show(halfFour(-8)), seen.splice(0).length);
  await attempt("then after a reaction that answers a promise of a string", () => Promise.resolve(4).then(() => Promise.resolve("4")).then(halfFive));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfFive(4)), show(halfFive(3)), show(halfFive(0.5)), show(halfFive(-8)), seen.splice(0).length);
  console.log("honest", show(halfSix(4)), show(halfSix(3)), show(halfSix(0.5)), show(halfSix(-8)), seen.splice(0).length);
  await attempt("then after a reaction that answers nothing", () => Promise.resolve(4).then(() => {}).then(halfSix));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfSix(4)), show(halfSix(3)), show(halfSix(0.5)), show(halfSix(-8)), seen.splice(0).length);
  await attempt("finally lets the value through", () => Promise.resolve("4").finally(() => 8).then(halfSeven));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfSeven(4)), show(halfSeven(3)), show(halfSeven(0.5)), show(halfSeven(-8)), seen.splice(0).length);
  console.log("honest", show(halfEight(4)), show(halfEight(3)), show(halfEight(0.5)), show(halfEight(-8)), seen.splice(0).length);
  await attempt("catch answers in place of the value", () => Promise.reject(4).catch(() => "4").then(halfEight));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfEight(4)), show(halfEight(3)), show(halfEight(0.5)), show(halfEight(-8)), seen.splice(0).length);
  await attempt("Promise.all of nothing", () => Promise.all([]).then(firstNine));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(firstNine([1, 2])), show(firstNine([])), show(firstNine(new Array(4, 5))), show(firstNine([0.5])), seen.splice(0).length);
  console.log("honest", show(firstTen([1, 2])), show(firstTen([])), show(firstTen(new Array(4, 5))), show(firstTen([0.5])), seen.splice(0).length);
  await attempt("Promise.all of a string", () => Promise.all("ab").then(firstTen));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(firstTen([1, 2])), show(firstTen([])), show(firstTen(new Array(4, 5))), show(firstTen([0.5])), seen.splice(0).length);
  await attempt("Promise.race answers one value, not a list", () => Promise.race([[7], 8]).then(firstEleven));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(firstEleven([1, 2])), show(firstEleven([])), show(firstEleven(new Array(4, 5))), show(firstEleven([0.5])), seen.splice(0).length);
  console.log("honest", show(halfTwelve(4)), show(halfTwelve(3)), show(halfTwelve(0.5)), show(halfTwelve(-8)), seen.splice(0).length);
  await attempt("the keys of an array in for-in are strings", () => { const out = []; for (const key in [7, 8]) out.push(halfTwelve(key)); return out; });
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfTwelve(4)), show(halfTwelve(3)), show(halfTwelve(0.5)), show(halfTwelve(-8)), seen.splice(0).length);
  await attempt("Object.keys of an array are strings", () => Object.keys([7, 8]).map(key => halfThirteen(key)));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfThirteen(4)), show(halfThirteen(3)), show(halfThirteen(0.5)), show(halfThirteen(-8)), seen.splice(0).length);
  console.log("honest", show(halfFourteen(4)), show(halfFourteen(3)), show(halfFourteen(0.5)), show(halfFourteen(-8)), seen.splice(0).length);
  await attempt("the keys that entries of an object hand over are strings", () => Object.entries({ 4: "a" }).map(([key]) => halfFourteen(key)));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfFourteen(4)), show(halfFourteen(3)), show(halfFourteen(0.5)), show(halfFourteen(-8)), seen.splice(0).length);
  await attempt("the keys of a Map keep their kind", () => [...new Map([[4, 1], ["4", 2]]).keys()].map(key => halfFifteen(key)));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfFifteen(4)), show(halfFifteen(3)), show(halfFifteen(0.5)), show(halfFifteen(-8)), seen.splice(0).length);
  console.log("honest", show(halfSixteen(4)), show(halfSixteen(3)), show(halfSixteen(0.5)), show(halfSixteen(-8)), seen.splice(0).length);
  await attempt("a Map makes negative zero positive", () => [...new Map([[-0, 1]]).keys()].map(key => halfSixteen(key)));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfSixteen(4)), show(halfSixteen(3)), show(halfSixteen(0.5)), show(halfSixteen(-8)), seen.splice(0).length);
  await attempt("a Set makes negative zero positive", () => [...new Set([-0])].map(key => halfSeventeen(key)));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfSeventeen(4)), show(halfSeventeen(3)), show(halfSeventeen(0.5)), show(halfSeventeen(-8)), seen.splice(0).length);
  console.log("honest", show(halfEighteen(4)), show(halfEighteen(3)), show(halfEighteen(0.5)), show(halfEighteen(-8)), seen.splice(0).length);
  await attempt("the key a reviver gets is a string", () => JSON.parse("[8]", key => halfEighteen(key)));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfEighteen(4)), show(halfEighteen(3)), show(halfEighteen(0.5)), show(halfEighteen(-8)), seen.splice(0).length);
  await attempt("a typed array rounds what the callback answers", () => Array.from(new Uint8Array([3, 5]).map(halfNineteen)));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfNineteen(4)), show(halfNineteen(3)), show(halfNineteen(0.5)), show(halfNineteen(-8)), seen.splice(0).length);
  console.log("honest", show(halfTwenty(4)), show(halfTwenty(3)), show(halfTwenty(0.5)), show(halfTwenty(-8)), seen.splice(0).length);
  await attempt("sort converts what the comparator answers", () => [3, 1, 2].sort((a, b) => String(halfTwenty(a - b))));
  console.log("  the callback computed:", seen.splice(0).join(" "));
  console.log("honest", show(halfTwenty(4)), show(halfTwenty(3)), show(halfTwenty(0.5)), show(halfTwenty(-8)), seen.splice(0).length);
}

main();
