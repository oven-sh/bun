// A key that is deleted and stored again moves to the end.
type Options = { port?: number; host: string };
function hostName() {
  return "localhost";
}
function make(port: number): Options {
  return { port, host: hostName() };
}
const options = make(1);
delete options.port;
options.port = 2;
console.log(Object.keys(options).join(), Object.keys(make(3)).join());
