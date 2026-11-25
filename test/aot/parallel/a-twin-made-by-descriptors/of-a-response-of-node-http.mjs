// Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)), written as one call, gives the twin what a look at the source finds: under the symbols of node:http too.
import http from "node:http";

const differing = object => {
  const twin = Object.defineProperties({}, Object.getOwnPropertyDescriptors(object));
  return Reflect.ownKeys(twin).filter(key => !Object.is(twin[key], object[key])).map(String).join();
};
const server = http.createServer((req, res) => {
  res.setHeader("X-One", "1");
  const twin = Object.defineProperties({}, Object.getOwnPropertyDescriptors(res));
  const headers = Object.getOwnPropertySymbols(twin).find(symbol => symbol.description === "kOutHeaders");
  console.log(req.url, "the headers of the twin:", JSON.stringify(twin[headers]));
  console.log(req.url, "differs from its source:", "[" + differing(req) + "]", "[" + differing(req.socket) + "]", "[" + differing(res) + "]");
  res.end("b");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
console.log(await (await fetch(url + "/first")).text());
console.log(await (await fetch(url + "/second")).text());
server.close();
