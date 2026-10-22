const box = { value: 1 };
class Target {
  constructor(holder) {
    holder.value = "text";
  }
}
const made = new (new Proxy(Target, {}))(box);
console.log(typeof box.value, box.value.length);
