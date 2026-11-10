// One operation of the program is often several calls of the compiled code in a row: an iteration asks for the iterator, for each step and for the end; a pattern reads one getter after the other; a template converts each of its values; an await calls and then waits. Each of the functions that are called that way says where it was called from, and throws in its turn, inside and outside of a try. What is caught, by whom, and every line and column of every stack are plain Bun's.
function whereAmI() {
  return new Error("here").stack
    .split("\n")
    .slice(2, 5)
    .map(line => line.trim().replace(/\(?[^\s(]*[\\/]([^\\/:]+:\d+:\d+)\)?$/, "$1"))
    .join(" < ");
}
let turn = 0;
let failAt = -1;
function step(name) {
  const mine = turn++;
  console.log(mine, name, whereAmI());
  if (mine === failAt) throw new Error("failed at " + name + " " + mine);
  return mine;
}
const iterable = {
  [Symbol.iterator]() {
    step("iterator");
    let count = 0;
    return {
      next() { step("next"); return { get done() { step("done"); return count++ >= 2; }, get value() { return step("value"); } }; },
      return() { step("return"); return {}; },
    };
  },
};
const getters = { get a() { return step("a"); }, get b() { return step("b"); }, get c() { return step("c"); } };
const primitive = name => ({ [Symbol.toPrimitive]() { return step(name); } });
const thenable = name => ({ then(resolve) { step(name); resolve(name); } });
class Checked { static [Symbol.hasInstance]() { return step("hasInstance") >= 0; } }
function tag(strings, ...values) { step("tag"); return values.length; }

function iteration() { let sum = 0; for (const value of iterable) sum += value; return sum; }
function iterationInTry() { let sum = 0; try { for (const value of iterable) sum += value; } catch (error) { console.log("caught in iterationInTry:", error.message); sum = -1; } finally { step("finally"); } return sum; }
function pattern() { const { a, b, c } = getters; return a + b + c; }
function patternInTry() { try { const { a, b, c } = getters; return a + b + c; } catch (error) { console.log("caught in patternInTry:", error.message); return -1; } }
function spread() { return Math.max(...iterable, ...iterable); }
function spreadInTry() { try { return [...iterable, ...iterable].length; } catch (error) { console.log("caught in spreadInTry:", error.message); return -1; } }
function template() { return `${primitive("x")}${primitive("y")}${primitive("z")}`; }
function templateInTry() { try { return `${primitive("x")}${primitive("y")}${primitive("z")}`; } catch (error) { console.log("caught in templateInTry:", error.message); return "-"; } }
function arithmetic() { return primitive("left") * primitive("right") + primitive("third"); }
function comparison() { return primitive("left") < primitive("right") || primitive("left") == 3; }
function tests() { return ({}) instanceof Checked && tag`a${step("in the tag")}b${step("again")}c` > 0; }
function twoOnOneLine() { return step("first") + step("second") + step("third"); }
function halfInTry() { let sum = step("outside"); try { sum += step("inside"); } catch (error) { console.log("caught in halfInTry:", error.message); } return sum + step("behind"); }
async function waiting() { const first = await thenable("first"); const second = await thenable("second"); return first + second; }
async function waitingInTry() { try { return (await thenable("first")) + (await thenable("second")); } catch (error) { console.log("caught in waitingInTry:", error.message); return "-"; } }
async function* generating() { yield step("yielded"); yield* [step("delegated"), step("delegated again")]; }
async function consuming() { let sum = 0; for await (const value of generating()) sum += value; return sum; }

const plain = [iteration, iterationInTry, pattern, patternInTry, spread, spreadInTry, template, templateInTry, arithmetic, comparison, tests, twoOnOneLine, halfInTry];
const asynchronous = [waiting, waitingInTry, consuming];
for (const run of plain) {
  for (failAt = -1; failAt < 14; failAt++) {
    turn = 0;
    try { console.log(run.name, failAt, String(run())); } catch (error) { console.log(run.name, failAt, "threw", error.message); }
  }
}
for (const run of asynchronous) {
  for (failAt = -1; failAt < 5; failAt++) {
    turn = 0;
    try { console.log(run.name, failAt, String(await run())); } catch (error) { console.log(run.name, failAt, "threw", error.message); }
  }
}
