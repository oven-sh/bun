const box = { value: 1 };
function target() {
  this.value = "text";
}
target.bind(box).bind(null)();
console.log(typeof box.value, box.value.length);
