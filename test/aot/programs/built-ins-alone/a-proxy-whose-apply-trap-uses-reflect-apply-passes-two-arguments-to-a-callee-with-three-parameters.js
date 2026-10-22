const handler = {
  apply(callee, self, passed) {
    return Reflect.apply(callee, self, passed);
  },
};
function target(first, second, third, fourth = "default") {
  console.log(first + 1, second.length);
  console.log(third === undefined, typeof third, fourth.length);
  console.log(arguments.length);
}
new Proxy(target, handler)(1.5, "two");
