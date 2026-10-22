const box = { value: 1 };
function target() {
  this.value = "text";
}
Reflect.apply(target, box, []);
console.log(typeof box.value, box.value.length);
