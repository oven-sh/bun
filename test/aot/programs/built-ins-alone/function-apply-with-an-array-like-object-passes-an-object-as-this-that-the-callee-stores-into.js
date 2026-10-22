const box = { value: 1 };
function target() {
  this.value = "text";
}
target.apply(box, { length: 0 });
console.log(typeof box.value, box.value.length);
