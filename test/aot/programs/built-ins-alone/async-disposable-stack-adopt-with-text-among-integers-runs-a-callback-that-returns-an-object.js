const subject = new AsyncDisposableStack();
function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = subject.adopt("text", callback);
console.log(typeof result, result.length, result);
