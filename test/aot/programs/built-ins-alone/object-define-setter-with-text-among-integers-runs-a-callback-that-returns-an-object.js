const subject = { first: 1, second: 2 };
function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = subject.__defineSetter__("an", callback);
console.log(typeof result, result === undefined, typeof subject, Object.keys(subject).join());
console.log(typeof subject.first, subject.first + 1, typeof subject.second, subject.second + 1);
console.log(typeof subject.an, subject.an === undefined);
