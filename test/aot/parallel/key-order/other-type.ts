// A store of a value that the slot of a field cannot hold leaves the key where it is.
function hostName() {
  return "localhost";
}
function make(port: number) {
  return { port, host: hostName() };
}
const options = make(1);
(options as { port: unknown }).port = "one";
console.log(JSON.stringify(Object.entries(options)), JSON.stringify(Object.entries(make(2))));
