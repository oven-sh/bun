const subject = [].values();
function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = subject.flatMap(callback);
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value === undefined, [...result].length);
