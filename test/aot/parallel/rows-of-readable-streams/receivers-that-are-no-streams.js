// Off another receiver some members throw and some answer a promise that is rejected.
// What `body` of a Response answers is known to be a stream: it is the very stream that the Response was made of.
const known = (...operands) => new Response(new ReadableStream(...operands)).body;
const lines = [];
async function ask(holder, name, ...operands) {
  let outcome;
  try {
    const answered = holder[name].call({}, ...operands);
    outcome =
      answered instanceof Promise
        ? await answered.then(
            () => "settled",
            error => `rejected ${error.name} ${error.code ?? ""}`,
          )
        : `answered ${typeof answered}`;
  } catch (error) {
    outcome = `threw ${error.name} ${error.code ?? ""}`;
  }
  lines.push(`${name}: ${outcome}`);
}
const ofStream = ReadableStream.prototype;
for (const name of ["cancel", "getReader", "pipeThrough", "pipeTo", "tee", "values", "text", "json", "bytes", "blob"]) await ask(ofStream, name);
const ofReader = ReadableStreamDefaultReader.prototype;
for (const name of ["cancel", "read", "readMany", "releaseLock"]) await ask(ofReader, name);
const ofIterator = Object.getPrototypeOf(known().values());
for (const name of ["next", "return"]) await ask(ofIterator, name);
console.log(lines.join("\n"));
console.log(ofStream[Symbol.asyncIterator] === ofStream.values, Reflect.ownKeys(ofIterator).join(), Object.getPrototypeOf(ofIterator) === Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf((async function* () {})()))));
