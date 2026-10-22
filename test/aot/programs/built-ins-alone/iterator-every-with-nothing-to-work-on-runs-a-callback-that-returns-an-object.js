const subject = [].values();
function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = subject.every(callback);
console.log(typeof result, result);
