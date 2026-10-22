const box = { value: 1 };
class Target {
  constructor(holder) {
    holder.value = "text";
  }
}
class Other extends Target {}
const made = Reflect.construct(Target, [box], Other);
console.log(typeof box.value, box.value.length);
