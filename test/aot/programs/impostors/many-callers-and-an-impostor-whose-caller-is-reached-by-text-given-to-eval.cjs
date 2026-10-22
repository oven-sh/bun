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

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
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

function sneakOne() {
  seen.push(show(totalOne("12")), show(halfOne("4")));
}

function totalTwo(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfTwo(n) {
  return n / 2;
}

const textTwo = ["seen.push(show(totalTwo('12')), ", "show(halfTwo('4')))"].join("");

function totalThree(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfThree(n) {
  return n / 2;
}

const textThree = ["(function () { seen.push(show(totalThree('12')), ", "show(halfThree('4'))); })"].join("");

function totalFour(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfFour(n) {
  return n / 2;
}

function callerFour() {
  var list = [1, 2];
  var n = 4;
  eval(["var list = '12', ", "n = '4'"].join(""));
  seen.push(show(totalFour(list)), show(halfFour(n)));
}

function totalFive(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfFive(n) {
  return n / 2;
}

function callerFive() {
  let list = [1, 2];
  let n = 4;
  eval(["list = '12'; ", "n = '4'"].join(""));
  seen.push(show(totalFive(list)), show(halfFive(n)));
}

function totalSix(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfSix(n) {
  return n / 2;
}

function callerSix() {
  eval(["totalSix = function () { return 'replaced'; }; ", "halfSix = function () { return 'replaced'; }"].join(""));
  seen.push(show(totalSix([1, 2])), show(halfSix(4)));
}

console.log("strict:", (function () { return this === undefined; })());
attempt("the text names the caller", () => eval("sneak" + "One" + "()"));
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalOne([1, 2, 3]), totalOne([]), totalOne(new Array(4, 5)), totalOne([0.5]), halfOne(4), halfOne(3), halfOne(0.5), halfOne(-8));
console.log("honest", totalTwo([1, 2, 3]), totalTwo([]), totalTwo(new Array(4, 5)), totalTwo([0.5]), halfTwo(4), halfTwo(3), halfTwo(0.5), halfTwo(-8));
attempt("the text is the caller", () => eval(textTwo));
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalTwo([1, 2, 3]), totalTwo([]), totalTwo(new Array(4, 5)), totalTwo([0.5]), halfTwo(4), halfTwo(3), halfTwo(0.5), halfTwo(-8));
attempt("the text makes a function that is the caller", () => eval(textThree)());
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalThree([1, 2, 3]), totalThree([]), totalThree(new Array(4, 5)), totalThree([0.5]), halfThree(4), halfThree(3), halfThree(0.5), halfThree(-8));
console.log("honest", totalFour([1, 2, 3]), totalFour([]), totalFour(new Array(4, 5)), totalFour([0.5]), halfFour(4), halfFour(3), halfFour(0.5), halfFour(-8));
attempt("the text declares a variable that holds the impostor", () => callerFour());
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalFour([1, 2, 3]), totalFour([]), totalFour(new Array(4, 5)), totalFour([0.5]), halfFour(4), halfFour(3), halfFour(0.5), halfFour(-8));
attempt("the text stores the impostor in the caller's variables", () => callerFive());
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalFive([1, 2, 3]), totalFive([]), totalFive(new Array(4, 5)), totalFive([0.5]), halfFive(4), halfFive(3), halfFive(0.5), halfFive(-8));
console.log("honest", totalSix([1, 2, 3]), totalSix([]), totalSix(new Array(4, 5)), totalSix([0.5]), halfSix(4), halfSix(3), halfSix(0.5), halfSix(-8));
attempt("the text replaces the function itself", () => callerSix());
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalSix([1, 2, 3]), totalSix([]), totalSix(new Array(4, 5)), totalSix([0.5]), halfSix(4), halfSix(3), halfSix(0.5), halfSix(-8));
