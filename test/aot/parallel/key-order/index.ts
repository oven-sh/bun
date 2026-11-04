// An index that is stored last is listed ahead of every name.
function hostName() {
  return "localhost";
}
function make(port: number) {
  return { port, host: hostName() };
}
const options = make(1);
(options as typeof options & Record<number, unknown>)[0] = "zero";
console.log(Object.keys(options).join(), Object.keys(make(2)).join());
