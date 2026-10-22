const box = { value: 1 };
function target(holder) {
  holder.value = "text";
}
target.apply(undefined, { length: 1, 0: box });
console.log(typeof box.value, box.value.length);
