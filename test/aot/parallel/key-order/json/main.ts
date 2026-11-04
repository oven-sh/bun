// The object of a JSON file has the order of the file, whatever order the literals of the same type have.
import data from "./data.json";

type Options = { port: number; host: string };
function hostName() {
  return "localhost";
}
function make(port: number): Options {
  return { port, host: hostName() };
}
function keys(options: Options) {
  return Object.keys(options).join();
}
console.log(keys(make(1)), keys(data));
