const subject = new AsyncDisposableStack();
function callback() {
  console.log("callback", arguments.length);
  return 0;
}
const result = subject.defer(callback);
console.log(typeof result, result === undefined);
