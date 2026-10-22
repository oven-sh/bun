const subject = new DisposableStack();
function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = subject.adopt("an", callback);
console.log(typeof result, result.length, result);
