const box = { value: 1 };
class Target {
  constructor(holder) {
    holder.value = "text";
  }
}
const made = Reflect.construct(Target, [box]);
console.log(typeof box.value, box.value.length);
