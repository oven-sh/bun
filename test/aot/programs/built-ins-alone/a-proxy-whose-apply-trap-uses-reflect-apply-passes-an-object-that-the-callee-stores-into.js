const handler = {
  apply(callee, self, passed) {
    return Reflect.apply(callee, self, passed);
  },
};
const box = { value: 1 };
function target(holder) {
  holder.value = "text";
}
new Proxy(target, handler)(box);
console.log(typeof box.value, box.value.length);
