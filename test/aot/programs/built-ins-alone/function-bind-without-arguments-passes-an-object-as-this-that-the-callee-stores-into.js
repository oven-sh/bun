const box = { value: 1 };
function target() {
  this.value = "text";
}
target.bind(box)();
console.log(typeof box.value, box.value.length);
