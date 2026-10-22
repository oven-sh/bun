const subject = [].values();
function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = subject.reduce(callback, 2.5);
console.log(typeof result, result + 1);
