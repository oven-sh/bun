let receiver;
const box = { value: 1 };
function target(holder) {
  holder.value = "text";
}
function relay() {
  return target.apply(receiver, arguments);
}
((receiver = undefined), relay(box));
console.log(typeof box.value, box.value.length);
