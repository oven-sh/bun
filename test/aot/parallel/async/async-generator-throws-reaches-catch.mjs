// What the body of an async generator throws rejects the step that was asked for: a `for await` around it goes to its `catch`, and nothing is left over for the end of the program.
// variant-stub-copies-1.test.ts always takes this program: there the code is laid out with several copies of the shared stubs, as in a very large program.
async function* producer(limit) {
  for (let i = 0; i < limit; i++) yield i;
  throw new RangeError("thrown by the producer");
}
async function consume(limit) {
  const seen = [];
  try {
    for await (const value of producer(limit)) seen.push(value);
    seen.push("through");
  } catch (error) {
    seen.push("caught " + error.message);
  }
  return seen.join();
}
console.log(await consume(0));
console.log(await consume(2));
const stepped = producer(1);
console.log(JSON.stringify(await stepped.next()));
console.log(await stepped.next().then(result => "fulfilled " + JSON.stringify(result), error => "rejected " + error.message));
console.log(JSON.stringify(await stepped.next()));
