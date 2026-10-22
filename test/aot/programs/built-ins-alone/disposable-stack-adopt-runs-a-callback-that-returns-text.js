const subject = new DisposableStack();
function callback() {
  console.log("callback", arguments.length);
  return "text";
}
const result = subject.adopt(1.5, callback);
console.log(typeof result, result + 1);
