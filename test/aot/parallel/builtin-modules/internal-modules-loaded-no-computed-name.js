// node:http and console.log bring internal/http and internal/util/inspect into the image. No loader answers either of them for a name that is made at run time, as in plain Bun.
// The answer is stored: Bun's own tests run with a variable that opens these modules to plain Bun.
const http = require("node:http");
const text = (encoded) => Buffer.from(encoded, "base64").toString();
const names = [text("aW50ZXJuYWwvdXRpbC9pbnNwZWN0"), text("aW50ZXJuYWwvaHR0cA=="), text("aW50ZXJuYWwvc3RyZWFtcy9zdGF0ZQ=="), text("bm9kZTpwYXRo")];

async function main() {
  console.log(typeof http.createServer, { a: 1 });
  for (const name of names) {
    const answers = [];
    try {
      answers.push(typeof require(name));
    } catch {
      answers.push("throws");
    }
    answers.push(typeof process.getBuiltinModule(name));
    try {
      answers.push(typeof require("node:module").createRequire(import.meta.url)(name));
    } catch {
      answers.push("throws");
    }
    try {
      answers.push(typeof (await import(name)));
    } catch {
      answers.push("throws");
    }
    console.log(name, answers.join(" "));
  }
}
main();
/* Output:
function {
  a: 1,
}
internal/util/inspect throws undefined throws throws
internal/http throws undefined throws throws
internal/streams/state throws undefined throws throws
node:path object object object object
*/
