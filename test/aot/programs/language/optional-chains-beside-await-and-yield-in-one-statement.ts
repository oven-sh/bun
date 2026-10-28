// Optional chains (`?.name`, `?.[key]`, `?.()`) in one statement with an `await` or a `yield` whose operand holds an arrow function, a function expression or a class: at the top of a module, in an async function and in generators, once where the chain ends early and once where it goes through.
type Deep = { deep: { read(value: number): number; list: number[]; call?: (value: number) => number } };
type Holder = { inner?: Deep };
const empty: Holder = {};
const full: Holder = { inner: { deep: { read: value => value * 10, list: [7, 8], call: value => value + 100 } } };
let seen: unknown[] = [];
function note<T>(value: T): T {
  seen.push(value);
  return value;
}
function show(name: string, ...values: unknown[]) {
  console.log(name, ...values, "saw", seen.join(" "));
  seen = [];
}

for (const holder of [empty, full]) {
  const byName: number =
    holder.inner?.deep.read(note(1)) ?? (await Promise.resolve(2).then((value: number) => note(value + 1)));
  const byKey: number =
    holder.inner?.["deep"].list[note(0)] ??
    (await Promise.resolve(2).then(function (value: number) {
      return note(value + 2);
    }));
  const byCall: number =
    holder.inner?.deep.call?.(note(1)) ??
    (
      await Promise.resolve(
        new (class {
          constructor(public size: number) {}
        })(note(5)),
      ).then((box: { size: number }) => box)
    ).size;
  show("declared", byName, byKey, byCall);

  const counter = { total: 0 };
  counter.total +=
    holder.inner?.deep.read(note(1)) ?? (await Promise.resolve(2).then<number>((value: number) => note(3)));
  counter.total +=
    holder.inner?.deep.read(note(1)) ??
    (await Promise.resolve(2).then(
      (value: number) => note(3),
      () => note(4),
    ));
  counter.total += holder.inner?.deep.read(note(1)) ?? (await (async (value: number) => note(value + 1))(2));
  show("added", counter.total);

  counter.total = holder.inner?.deep.read(await Promise.resolve(2).then((value: number) => note(value + 1))) ?? note(5);
  counter.total +=
    holder.inner?.deep.list[await Promise.resolve(0).then((value: number) => note(value + 1))] ?? note(6);
  counter.total +=
    holder.inner?.deep.call?.(await Promise.resolve(2).then((value: number) => note(value + 2))) ?? note(7);
  show("inside the chain", counter.total);

  counter.total = (await Promise.resolve(holder).then((value: Holder) => note(value)))?.inner?.deep.read(note(1)) ?? 3;
  seen[0] = typeof seen[0];
  show("on what was awaited", counter.total);

  show(
    "side by side",
    [holder.inner?.deep.call?.(note(1)), await Promise.resolve(2).then((value: number) => note(3))],
    [await Promise.resolve(2).then((value: number) => note(4)), holder.inner?.["deep"].list[note(1)]],
    await Promise.resolve(2).then((value: number) => holder.inner?.deep.read(note(value)) ?? note(9)),
  );
  for (const item of [holder.inner?.deep.read(note(1)), await Promise.resolve(2).then((value: number) => note(3))])
    show("in the head of a loop", item);
}

async function inAFunction(holder: Holder) {
  const counter = { total: 0 };
  counter.total +=
    holder.inner?.deep.read(note(1)) ?? (await Promise.resolve(2).then<number>((value: number) => note(3)));
  counter.total +=
    holder.inner?.["deep"].list[await Promise.resolve(0).then((value: number) => note(value))] ?? note(6);
  counter.total += holder.inner?.deep.call?.(note(1)) ?? (await (async (value: number) => note(value + 1))(2));
  return counter.total;
}
show("in an async function", await inAFunction(empty), await inAFunction(full));

function* steps(holder: Holder): Generator<(value: number) => number, number, number> {
  let total = 0;
  total += holder.inner?.deep.read(note(1)) ?? (yield (value: number) => value + 1);
  total +=
    holder.inner?.["deep"].list[note(0)] ??
    (yield function (value: number) {
      return value + 2;
    });
  total += holder.inner?.deep.call?.(yield (value: number) => value + 3) ?? note(4);
  total +=
    holder.inner?.deep.list[
      yield new (class {
        constructor(public step: (value: number) => number) {}
      })((value: number) => value - 10).step
    ] ?? note(5);
  return total;
}
function drive(holder: Holder) {
  const iterator = steps(holder);
  let step = iterator.next();
  while (!step.done) step = iterator.next(note(step.value(10)));
  return step.value;
}
show("in a generator", drive(empty), drive(full));

async function* both(holder: Holder): AsyncGenerator<number, number, number> {
  let total = 0;
  total +=
    holder.inner?.deep.read(note(1)) ?? (yield await Promise.resolve(2).then<number>((value: number) => note(value)));
  total += holder.inner?.deep.call?.(yield await Promise.resolve(3).then((value: number) => note(value))) ?? note(4);
  return total;
}
for (const holder of [empty, full]) {
  const iterator = both(holder);
  let step = await iterator.next();
  while (!step.done) step = await iterator.next(step.value * 2);
  show("in an async generator", step.value);
}
export {};
