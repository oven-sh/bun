const subject = new Uint8Array(0);
function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = subject.toSorted(callback);
console.log(result instanceof Uint8Array, result.length);
