// A generator is returned through and thrown into before its first step, in the middle and behind its end: what comes back is what was passed, which no yield and no return of the body hands out.
// Under: --aot-testing=CheckProofsAtRunTime: what a step hands out (LinkedCoroutine::yielded, returned, sent)
function* numbers() {
  try {
    yield 1;
    yield 2;
  } finally {
    log.push("finally");
  }
  return 3;
}
const log = [];
const show = step => typeof step.value + " " + String(step.value) + " " + step.done;
function deed(steps, how, passed) {
  const generator = numbers();
  for (let i = 0; i < steps; i++) generator.next();
  try {
    return show(generator[how](passed));
  } catch (error) {
    return "thrown " + typeof error + " " + String(error);
  }
}
for (const how of ["return", "throw"]) {
  for (let steps = 0; steps < 5; steps++) console.log(how, steps, deed(steps, how, "passed"), log.join());
}
let sum = 0;
for (let i = 0; i < 300; i++) for (const value of numbers()) sum += value;
console.log(sum, log.length);
console.log(deed(0, "return", { toString: () => "an object" }), deed(4, "return", undefined));
