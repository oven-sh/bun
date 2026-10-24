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

function totalOne(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfOne(n) {
  return n / 2;
}

const thenableOne = {
  then(resolve) {
    seen.push(show(totalOne("12")), show(halfOne("4")));
    resolve(1);
  },
};

function totalTwo(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfTwo(n) {
  return n / 2;
}

const thenableTwo = {
  then(resolve) {
    seen.push(show(totalTwo("12")), show(halfTwo("4")));
    resolve(1);
  },
};

function totalThree(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfThree(n) {
  return n / 2;
}

const thenableThree = {
  then(resolve) {
    seen.push(show(totalThree("12")), show(halfThree("4")));
    resolve(1);
  },
};

function totalFour(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfFour(n) {
  return n / 2;
}

function reactFour() {
  seen.push(show(totalFour("12")), show(halfFour("4")));
}

function totalFive(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfFive(n) {
  return n / 2;
}

function reactFive() {
  seen.push(show(totalFive("12")), show(halfFive("4")));
}

function totalSix(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfSix(n) {
  return n / 2;
}

function fireSix() {
  seen.push(show(totalSix("12")), show(halfSix("4")));
}

function totalSeven(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfSeven(n) {
  return n / 2;
}

function fireSeven() {
  seen.push(show(totalSeven("12")), show(halfSeven("4")));
}

function totalEight(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfEight(n) {
  return n / 2;
}

const objectEight = {
  [Symbol.asyncIterator]() {
    seen.push(show(totalEight("12")), show(halfEight("4")));
    return { next: async () => ({ done: true }) };
  },
};

function totalNine(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfNine(n) {
  return n / 2;
}

const targetNine = new EventTarget();
targetNine.addEventListener("sneak", function () {
  seen.push(show(totalNine("12")), show(halfNine("4")));
});

function totalTen(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfTen(n) {
  return n / 2;
}

const controllerTen = new AbortController();
controllerTen.signal.addEventListener("abort", function () {
  seen.push(show(totalTen("12")), show(halfTen("4")));
});

async function main() {
  console.log("strict:", (function () { return this === undefined; })());
  await attempt("the then of a thenable that is awaited", () => thenableOne);
  console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
  console.log("honest", totalOne([1, 2, 3]), totalOne([]), totalOne(new Array(4, 5)), totalOne([0.5]), halfOne(4), halfOne(3), halfOne(0.5), halfOne(-8));
  console.log("honest", totalTwo([1, 2, 3]), totalTwo([]), totalTwo(new Array(4, 5)), totalTwo([0.5]), halfTwo(4), halfTwo(3), halfTwo(0.5), halfTwo(-8));
  await attempt("the then of a thenable that an async function returns", () => (async () => thenableTwo)());
  console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
  console.log("honest", totalTwo([1, 2, 3]), totalTwo([]), totalTwo(new Array(4, 5)), totalTwo([0.5]), halfTwo(4), halfTwo(3), halfTwo(0.5), halfTwo(-8));
  await attempt("the then of a thenable given to Promise.all", () => Promise.all([thenableThree]));
  console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
  console.log("honest", totalThree([1, 2, 3]), totalThree([]), totalThree(new Array(4, 5)), totalThree([0.5]), halfThree(4), halfThree(3), halfThree(0.5), halfThree(-8));
  console.log("honest", totalFour([1, 2, 3]), totalFour([]), totalFour(new Array(4, 5)), totalFour([0.5]), halfFour(4), halfFour(3), halfFour(0.5), halfFour(-8));
  await attempt("a reaction", () => Promise.resolve().then(reactFour));
  console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
  console.log("honest", totalFour([1, 2, 3]), totalFour([]), totalFour(new Array(4, 5)), totalFour([0.5]), halfFour(4), halfFour(3), halfFour(0.5), halfFour(-8));
  await attempt("a finally reaction", () => Promise.resolve(1).finally(reactFive));
  console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
  console.log("honest", totalFive([1, 2, 3]), totalFive([]), totalFive(new Array(4, 5)), totalFive([0.5]), halfFive(4), halfFive(3), halfFive(0.5), halfFive(-8));
  console.log("honest", totalSix([1, 2, 3]), totalSix([]), totalSix(new Array(4, 5)), totalSix([0.5]), halfSix(4), halfSix(3), halfSix(0.5), halfSix(-8));
  await attempt("a timer", () => (setTimeout(fireSix, 0), new Promise(resolve => setTimeout(resolve, 0))));
  console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
  console.log("honest", totalSix([1, 2, 3]), totalSix([]), totalSix(new Array(4, 5)), totalSix([0.5]), halfSix(4), halfSix(3), halfSix(0.5), halfSix(-8));
  await attempt("a microtask", () => (queueMicrotask(fireSeven), Promise.resolve().then(() => 1)));
  console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
  console.log("honest", totalSeven([1, 2, 3]), totalSeven([]), totalSeven(new Array(4, 5)), totalSeven([0.5]), halfSeven(4), halfSeven(3), halfSeven(0.5), halfSeven(-8));
  console.log("honest", totalEight([1, 2, 3]), totalEight([]), totalEight(new Array(4, 5)), totalEight([0.5]), halfEight(4), halfEight(3), halfEight(0.5), halfEight(-8));
  await attempt("Symbol.asyncIterator", () => (async () => { for await (const item of objectEight); })());
  console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
  console.log("honest", totalEight([1, 2, 3]), totalEight([]), totalEight(new Array(4, 5)), totalEight([0.5]), halfEight(4), halfEight(3), halfEight(0.5), halfEight(-8));
  await attempt("a listener of an event target", () => targetNine.dispatchEvent(new Event(["sn", "eak"].join(""))));
  console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
  console.log("honest", totalNine([1, 2, 3]), totalNine([]), totalNine(new Array(4, 5)), totalNine([0.5]), halfNine(4), halfNine(3), halfNine(0.5), halfNine(-8));
  console.log("honest", totalTen([1, 2, 3]), totalTen([]), totalTen(new Array(4, 5)), totalTen([0.5]), halfTen(4), halfTen(3), halfTen(0.5), halfTen(-8));
  await attempt("a listener of an abort signal", () => controllerTen.abort());
  console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
  console.log("honest", totalTen([1, 2, 3]), totalTen([]), totalTen(new Array(4, 5)), totalTen([0.5]), halfTen(4), halfTen(3), halfTen(0.5), halfTen(-8));
}

main();
