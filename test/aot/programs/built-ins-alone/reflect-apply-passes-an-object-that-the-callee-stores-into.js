const box = { value: 1 };
function target(holder) {
  holder.value = "text";
}
Reflect.apply(target, undefined, [box]);
console.log(typeof box.value, box.value.length);
