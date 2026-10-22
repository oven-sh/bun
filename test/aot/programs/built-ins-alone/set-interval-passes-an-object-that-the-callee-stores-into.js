const box = { value: 1 };
function afterwards() {
  console.log(typeof box.value, box.value.length);
}
function target(holder) {
  holder.value = "text";
  clearInterval(this);
  afterwards();
}
setInterval(target, 1, box);
