const box = { value: 1 };
function target(holder) {
  holder.value = "text";
}
await Promise.try(target, box);
console.log(typeof box.value, box.value.length);
