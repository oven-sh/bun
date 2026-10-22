const handler = {
  apply(callee, self, passed) {
    return Reflect.apply(callee, self, passed);
  },
};
const numbers = [1, 2];
function target(holder) {
  holder.push("three");
}
new Proxy(target, handler)(numbers);
console.log(numbers.length, typeof numbers[2], numbers[2].length);
