// A key that a descriptor makes not enumerable is listed no more.
function hostName() {
  return "localhost";
}
function make(port: number) {
  return { port, host: hostName() };
}
const options = make(1);
Object.defineProperty(options, "port", { enumerable: false });
console.log(Object.keys(options).join(), JSON.stringify({ ...options }), Object.keys(make(2)).join());
