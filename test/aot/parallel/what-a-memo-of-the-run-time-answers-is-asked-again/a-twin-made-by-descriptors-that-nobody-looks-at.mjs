// Flags: --aot-testing=CheckWalkAtRunTime
// Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)), written as one call, reads the slots of a compiled source as they lie. Under the word that checks the walk each name is asked again of the source as a look would find it, and every name that the source has must have been read.
// Nobody looks at the twins. Without the preparation at the head of the helper the first request stops by name under a symbol of node:http.
// COUNTER: FastPathResultsVerified >= 100
import http from "node:http";
class Kept { constructor() { this.own = 1; } }
class Source { constructor(n) { this.first = n; this.second = "s" + n; this[Symbol.for("made-up")] = [n]; } get third() { return 3; } }
const server = http.createServer((req, res) => {
  res.setHeader("X-One", "1");
  Object.defineProperties({}, Object.getOwnPropertyDescriptors(res));
  res.setHeader("X-Two", "2");
  Object.defineProperties(new Kept(), Object.getOwnPropertyDescriptors(res));
  Object.defineProperties({}, Object.getOwnPropertyDescriptors(req));
  res.end("b");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
console.log(await (await fetch(url + "/first")).text());
console.log(await (await fetch(url + "/second")).text());
server.close();
for (let i = 0; i < 3; i++) {
  const source = new Source(i);
  if (i === 1) source.later = i;
  if (i === 2) Object.defineProperty(source, "second", { get() { return "got"; }, enumerable: false, configurable: true });
  Object.defineProperties({}, Object.getOwnPropertyDescriptors(source));
  Object.defineProperties(new Kept(), Object.getOwnPropertyDescriptors(source));
}
console.log("ran");
