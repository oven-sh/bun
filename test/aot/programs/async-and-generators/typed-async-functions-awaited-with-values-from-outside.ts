// A typed async function is awaited at once by a caller that has proven nothing of its argument: the tests of the argument stand between the two.
// Whichever way the call is compiled, the turns of the job queue come in the order of the specification, for a value that fits the type and for one that does not,
// and an error leaves through the await.
const outside: any = JSON.parse('{"number":4,"text":"four","nothing":null,"list":[1,"two",3,null,{"valueOf":1}]}');
const log: string[] = [];

async function suspends(id: number): Promise<number> {
  log.push("suspends begins " + id);
  await null;
  log.push("suspends goes on " + id);
  return id + 1;
}
async function neverSuspends(id: number): Promise<number> {
  log.push("neverSuspends " + id);
  return id + 1;
}
async function suspendsSometimes(id: number): Promise<number> {
  if (id > 2) await null;
  log.push("suspendsSometimes " + id);
  return id * 2;
}
async function throwsAtOnce(id: number): Promise<number> {
  if (typeof id !== "number") throw new TypeError("not a number: " + id);
  return id;
}
async function takesTwo(id: number, name: string): Promise<string> {
  await null;
  return name + id;
}

async function awaitsSuspends(x: any) { return await suspends(x); }
async function awaitsNeverSuspends(x: any) { return await neverSuspends(x); }
async function awaitsSometimes(x: any) { return await suspendsSometimes(x); }
async function awaitsThrower(x: any) { try { return await throwsAtOnce(x); } catch (error) { return "caught " + (error as Error).message; } }
async function awaitsTwo(x: any, y: any) { return await takesTwo(x, y); }
async function keepsThePromise(x: any) { const promise = suspends(x); const value = await promise; return [value, promise instanceof Promise, await promise]; }
async function awaitsInALoop(list: any) { let text = ""; for (const item of list) text += "," + String(await suspendsSometimes(item)); return text; }

function ticks(name: string, count: number): Promise<void> {
  let promise = Promise.resolve();
  for (let i = 0; i < count; i++) promise = promise.then(() => { log.push(name + " tick " + i); });
  return promise;
}

async function main() {
  for (const value of [outside.number, outside.text, outside.nothing, undefined]) {
    for (const run of [awaitsSuspends, awaitsNeverSuspends, awaitsSometimes, awaitsThrower]) {
      const beside = ticks(run.name, 6);
      const result = run(value).then(answer => { log.push(run.name + " answers " + String(answer)); });
      await Promise.all([beside, result]);
    }
  }
  const beside = ticks("two", 6);
  await Promise.all([beside, awaitsTwo(outside.number, outside.text).then(answer => { log.push("two answers " + answer); }), awaitsTwo(outside.text, outside.number).then(answer => { log.push("two answers " + answer); })]);
  log.push(JSON.stringify(await keepsThePromise(outside.number)));
  log.push(await awaitsInALoop(outside.list));
  console.log(log.join("\n"));
}
main();
