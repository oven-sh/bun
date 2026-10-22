function first() {
  console.log("first");
}
function second() {
  console.log("second", typeof this);
}
const timer = setTimeout(first, 1);
console.log(timer._onTimeout === first);
timer._onTimeout = second;
