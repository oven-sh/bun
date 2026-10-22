const box = { value: 1 };
function target(holder) {
  holder.value = "text";
}
Function.prototype.apply.call(target, undefined, [box]);
console.log(typeof box.value, box.value.length);
