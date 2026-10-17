// `await f()` of an async function called by name takes the same turns of the job queue as any other await: against then callbacks, other awaits and each other.
const log: string[] = [];
const settled = Promise.resolve(0);
function ticks(name: string, count: number): void {
  let chain: Promise<unknown> = settled;
  for (let i = 1; i <= count; i++) chain = chain.then(() => log.push(name + " tick " + i));
}

async function returnsAtOnce(n: number): Promise<number> {
  return n * 10;
}
async function returnsNothing(n: number): Promise<void> {
  log.push("nothing " + n);
}
async function returnsText(n: number): Promise<string> {
  return "text " + n;
}
async function returnsObject(n: number): Promise<{ n: number }> {
  return { n };
}
async function returnsArray(n: number): Promise<number[]> {
  return [n, n + 1];
}
async function suspendsOnce(n: number): Promise<number> {
  log.push("once enters " + n);
  await settled;
  log.push("once resumes " + n);
  return n + 1;
}
async function suspendsTwice(n: number): Promise<number> {
  const a = await returnsAtOnce(n);
  log.push("twice has a " + n);
  const b = await suspendsOnce(n);
  log.push("twice has b " + n);
  return a + b;
}
async function sometimesSuspends(n: number): Promise<number> {
  if (n & 1) await settled;
  return n;
}
async function middle(n: number): Promise<number> {
  log.push("middle enters " + n);
  const value = await suspendsTwice(n);
  log.push("middle has " + value);
  return value + 1;
}
async function outer(n: number): Promise<number> {
  return (await middle(n)) * 2;
}
async function awaitsInArguments(n: number): Promise<number> {
  return (await returnsAtOnce(await returnsAtOnce(n))) + (await suspendsOnce(await sometimesSuspends(n)));
}

async function worker(name: string, n: number): Promise<number> {
  log.push(name + " starts");
  const a = await returnsAtOnce(n);
  log.push(name + " a " + a);
  await returnsNothing(n);
  log.push(name + " after nothing");
  const text = await returnsText(n);
  log.push(name + " " + text);
  const object = await returnsObject(n);
  log.push(name + " object " + object.n);
  const array = await returnsArray(n);
  log.push(name + " array " + array.join());
  const once = await suspendsOnce(n);
  log.push(name + " once " + once);
  const deep = await outer(n);
  log.push(name + " deep " + deep);
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    sum += await sometimesSuspends(n + i);
    log.push(name + " sum " + sum);
  }
  const nested = await awaitsInArguments(n);
  log.push(name + " nested " + nested);
  return a + once + deep + sum + nested;
}

async function main(): Promise<void> {
  ticks("early", 6);
  const first = worker("first", 1);
  ticks("between", 40);
  const second = worker("second", 2);
  log.push("main goes on");
  const x = await settled;
  log.push("main settled " + x);
  const inline = await (async (): Promise<number> => await returnsAtOnce(5))();
  log.push("main inline " + inline);
  log.push("workers " + (await first) + " " + (await second));
  ticks("late", 12);
  log.push("main deep " + (await outer(3)));
  log.push("main last " + (await worker("third", 3)));
}

main().then(() => {
  for (const line of log) console.log(line);
});
console.log("the module ends");
