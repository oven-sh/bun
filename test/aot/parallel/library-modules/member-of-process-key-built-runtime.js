// `process` is handed to a function that reads a member under a key put together at run time. Nobody can tell which member that is, so all of them work.
function read(object, key) {
  return object[key];
}
const stream = read(process, ["std", "out"].join(""));
console.log(typeof stream, typeof stream.write);
console.log(typeof read(process, ["p", "id"].join("")));
