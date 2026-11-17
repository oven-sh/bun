// A list is as its class makes it until the body hands it on. Who takes it may give it a push of its own, another prototype, or freeze it: every push behind that goes by what the list is then.
type Take = (list: unknown[]) => void;
const takers: Record<string, Take> = {
  nothing() {},
  ownPush(list) { (list as any).push = function (this: unknown[], value: unknown) { Array.prototype.push.call(this, "own", value); return -1; }; },
  otherPrototype(list) { Object.setPrototypeOf(list, { push(this: any, value: unknown) { this[this.length] = ["below", value]; return -2; } }); },
  frozen(list) { Object.freeze(list); },
  getter(list) { Object.defineProperty(list, "push", { get() { return () => "from a getter"; } }); },
};
function secondLoop(items: any[], take: Take) {
  const list: unknown[] = [];
  const answers: unknown[] = [];
  for (const item of items) answers.push(list.push({ a: item.a }));
  take(list);
  for (const item of items) {
    try { answers.push(list.push({ b: item.b })); } catch (error) { answers.push((error as Error).constructor.name); }
  }
  return { list: Array.from(list), answers };
}
function inTurn(items: any[], take: Take) {
  const list: unknown[] = [];
  const answers: unknown[] = [];
  for (const item of items) {
    try { answers.push(list.push({ a: item.a })); } catch (error) { answers.push((error as Error).constructor.name); }
    take(list);
  }
  return { list: Array.from(list), answers };
}
function laterInTurn(items: any[], take: Take) {
  const list: unknown[] = [];
  const answers: unknown[] = [];
  for (const item of items) {
    answers.push(list.push({ a: item.a }));
    if (item.a > 0) take(list);
  }
  return answers;
}
function madeInTurn(rows: any[][], take: Take) {
  const all: unknown[] = [];
  for (const items of rows) {
    const list: unknown[] = [];
    for (const item of items) list.push({ a: item.a });
    take(list);
    all.push(Array.from(list), Object.isFrozen(list), Object.hasOwn(list, "push"));
  }
  return all;
}
function takeAndThrow(list: unknown[], take: Take): never {
  take(list);
  throw new Error("again");
}
function backThroughHandler(items: any[], take: Take) {
  const list: unknown[] = [];
  const answers: unknown[] = [];
  for (let round = 0; round < 3; round++) {
    try {
      for (const item of items) answers.push(list.push({ a: item.a, round }));
      takeAndThrow(list, take);
      return "never";
    } catch (error) {
      answers.push((error as Error).constructor.name);
    }
  }
  return answers;
}
const items = JSON.parse(process.argv[2] ?? '[{"a":1,"b":2},{"a":3,"b":4}]');
for (const name of Object.keys(takers)) {
  const take = takers[name];
  for (const run of [secondLoop, inTurn, laterInTurn, backThroughHandler]) {
    let said: string;
    try { said = JSON.stringify(run(items, take)); } catch (error) { said = "threw " + (error as Error).constructor.name; }
    console.log(name, run.name, said);
  }
  console.log(name, "madeInTurn", JSON.stringify(madeInTurn([items, items], take)));
}
