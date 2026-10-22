let receiver;
const box = { value: 1 };
function target() {
  this.value = "text";
}
function relay() {
  return target.apply(receiver, arguments);
}
((receiver = box), relay());
console.log(typeof box.value, box.value.length);
