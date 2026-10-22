const box = { value: 1 };
class Target {
  constructor(holder) {
    holder.value = "text";
  }
}
const handler = {
  construct(callee, passed) {
    return Reflect.construct(callee, passed);
  },
};
const made = new (new Proxy(Target, handler))(box);
console.log(typeof box.value, box.value.length);
