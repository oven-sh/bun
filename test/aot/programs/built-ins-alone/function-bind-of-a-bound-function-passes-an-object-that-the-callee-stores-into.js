const box = { value: 1 };
function target(holder) {
  holder.value = "text";
}
target.bind(undefined, box).bind(null)();
console.log(typeof box.value, box.value.length);
