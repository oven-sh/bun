// Async functions that end alike, each awaited where it is called, at the top level of a module and in a function. The compiler calls such a function without a promise and shares code that occurs many times: the end of an async function, which resumes whoever awaits it, has to stay in the function.
const sleep = () => new Promise(resolve => setTimeout(resolve, 1));
await (async () => { await sleep(); console.log("top level", 1); })();
await (async () => { await null; console.log("top level", 2); })();
await (async () => { await sleep(); console.log("top level", 3); })();
await (async () => { await Promise.resolve(1).then(value => value); console.log("top level", 4); })();
async function main() {
  await (async () => { await null; console.log("function", 1); })();
  await (async () => { await null; console.log("function", 2); })();
  await (async () => { await null; console.log("function", 3); })();
  await (async () => { await null; console.log("function", 4); })();
  await (async () => { await null; console.log("function", 5); })();
  return "done";
}
console.log(await main());
