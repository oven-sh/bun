// Direct evals of calls: the texts to which the constants of the file lead are compiled, the others are interpreted, and all do what the texts say.
const prefix = "tell";
const names = { day: "Day", hour: "Hour", both: "Both" };
let calls = 0;
function tellDay(value) {
  calls++;
  return "day " + (value % 7);
}
function tellHour(value) {
  calls++;
  return (value % 24) + "h";
}
const tellBoth = (value, between = "-") => tellDay(value) + between + tellHour(value >> 1);
function told(name, value) {
  return eval(prefix + names[name] + "(value)");
}
function toldDay(value) {
  return eval("tellDay(value + 1)");
}
function toldLater(value) {
  const own = number => "own " + number;
  const text = "own(" + "value * 2)";
  return eval(text);
}
function counted(value) {
  let calls = 100;
  eval("calls = calls + tellDay(value).length");
  return calls;
}
function made(value) {
  eval("var fresh = tellHour(value)");
  return typeof fresh === "undefined" ? "none" : fresh;
}
function spread(values) {
  return eval("tellBoth(...values)");
}
function ofThis(value) {
  return eval("this.scale * Number(value)");
}
const formats = ["tellDay", "tellHour"];
function table(value) {
  let out = "";
  for (const format of formats) out += eval(format + "(value)") + ";";
  return out;
}
for (let round = 0; round < 30; round++) {
  const line = [told("day", round), told("hour", round), told("both", round), toldDay(round), toldLater(round), counted(round), made(round), spread([round, "+"]), ofThis.call({ scale: 3 }, round), table(round)];
  if (round % 11 === 0) console.log(line.join(" | "), calls);
}
for (const name of ["none", "toString"]) {
  try {
    console.log(told(name, 3));
  } catch (error) {
    console.log(error.constructor.name);
  }
}
names.day = "Hour";
formats.push("(x => x + '!')");
console.log(told("day", 25), table(25));
var tellShared = value => "first " + value;
function shared(value) {
  return eval("tellShared(value)");
}
console.log(shared(1));
tellShared = value => "second " + value;
console.log(shared(2));
try {
  eval("tellNothing(1)");
} catch (error) {
  console.log(error.constructor.name, error.message.includes("tellNothing"));
}
try {
  eval("tellDay(");
} catch (error) {
  console.log(error.constructor.name);
}
const indirect = eval;
console.log(typeof indirect("typeof tellDay"), indirect("typeof tellDay"), eval("typeof tellDay"), eval("calls > 100"));
