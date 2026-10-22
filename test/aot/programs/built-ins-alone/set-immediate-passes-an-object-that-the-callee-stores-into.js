const box = { value: 1 };
function afterwards() {
  console.log(typeof box.value, box.value.length);
}
function target(holder) {
  holder.value = "text";
  afterwards();
}
setImmediate(target, box);
