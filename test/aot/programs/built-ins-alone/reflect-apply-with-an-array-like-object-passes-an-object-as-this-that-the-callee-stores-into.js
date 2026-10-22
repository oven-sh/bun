const box = { value: 1 };
function target() {
  this.value = "text";
}
Reflect.apply(target, box, { length: 0 });
console.log(typeof box.value, box.value.length);
