const box = { value: 1 };
function target(holder) {
  holder.value = "text";
}
target.call(undefined, box);
console.log(typeof box.value, box.value.length);
