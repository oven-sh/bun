const subject = { first: 1, second: 2 };
function callback() {
  console.log("callback", this === subject, arguments.length);
  return { made: 1.5 };
}
const result = subject.__defineGetter__("an", callback);
console.log(typeof result, result === undefined, typeof subject, Object.keys(subject).join());
console.log(typeof subject.first, subject.first + 1, typeof subject.second, subject.second + 1, typeof subject.an);
console.log(Object.keys(subject.an).join(), typeof subject.an.made, subject.an.made + 1);
