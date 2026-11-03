// Closures of one function run and throw in a loop, and then get a name through what came back out of a text made at run time. The stacks are read at the end. Each line: the names in the first frames, but for the closure that is the first of its function to get a name.
const firstFrame = stack =>
  stack
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const show = errors => console.log(errors.map(error => firstFrame(error.stack)).join(" | "));
const call = f => f();

const calledWhereItIsMade = [];
for (const name of [
  "the first name",
  "",
  "b",
  "",
  "d",
  "e",
  "f",
  "g",
  "",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
]) {
  const f = function written() {
    throw new Error("x");
  };
  try {
    f();
  } catch (error) {
    calledWhereItIsMade.push(error);
  }
  if (name) handedBack(f).displayName = name;
}
show(calledWhereItIsMade.slice(1));

const calledByAFunction = [];
for (const name of [
  "the first name",
  "",
  "b",
  "",
  "d",
  "e",
  "f",
  "g",
  "",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
]) {
  const f = function handedOn() {
    throw new Error("x");
  };
  try {
    call(f);
  } catch (error) {
    calledByAFunction.push(error);
  }
  if (name) handedBack(f).displayName = name;
}
show(calledByAFunction.slice(1));

const calledForAnElement = [];
for (const name of [
  "the first name",
  "",
  "b",
  "",
  "d",
  "e",
  "f",
  "g",
  "",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
]) {
  const f = function visitor() {
    throw new Error("x");
  };
  try {
    [1].forEach(f);
  } catch (error) {
    calledForAnElement.push(error);
  }
  if (name) handedBack(f).displayName = name;
}
show(calledForAnElement.slice(1));
