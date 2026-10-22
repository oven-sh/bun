const handler = {
  apply(callee, self, passed) {
    return Reflect.apply(callee, self, passed);
  },
};
function target(first, second, third, fourth, fifth) {
  console.log(typeof first, first + 1);
  console.log(typeof second, second + 1);
  console.log(typeof third, third.length);
  console.log(typeof fourth, fourth.four);
  console.log(typeof fifth, fifth());
  console.log(arguments.length);
}
new Proxy(target, handler)(1, 2.5, "three", { four: 4 }, () => "five");
