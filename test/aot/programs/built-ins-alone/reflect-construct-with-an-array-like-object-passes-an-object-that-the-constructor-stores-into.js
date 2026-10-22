const box = { value: 1 };
class Target {
  constructor(holder) {
    holder.value = "text";
  }
}
const made = Reflect.construct(Target, { length: 1, 0: box });
console.log(typeof box.value, box.value.length);
