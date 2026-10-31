const isDev = true;
if (isDev) {
  var hoisted = "http://localhost";
}
const R = typeof hoisted;
console.log(R);
