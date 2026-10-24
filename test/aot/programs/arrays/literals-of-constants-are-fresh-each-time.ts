// An array literal of constants shares its storage with the other arrays of its site until one of them is written. Each evaluation gives a new array, and a write to one is never seen in another.
function integers(): number[] { return [1, 2, 3, 4]; }
function doubles(): number[] { return [0.5, 1.5, -0, 2]; }
function values(): (string | null | boolean | undefined | number)[] { return ["a", null, true, undefined, 7]; }
function empty(): number[] { return []; }
function rarely(flag: boolean): number[] | undefined { if (flag) return [9, 8, 7]; return undefined; }

const show = (value: unknown): string => JSON.stringify(value, (_, item) => (item === undefined ? "undefined" : Object.is(item, -0) ? "-0" : item));

function writes(make: () => unknown[]): string {
  const out: string[] = [];
  const first = make();
  const second = make();
  out.push(String(first === second), show(first));
  first[0] = "changed";
  out.push(show(first), show(second), show(make()));
  second.push("pushed");
  out.push(show(second), String(second.length), show(make()));
  const third = make();
  third.length = 1;
  out.push(show(third), show(make()));
  const fourth = make();
  fourth.reverse();
  out.push(show(fourth), show(make()));
  const fifth = make();
  fifth[10] = "far";
  out.push(String(fifth.length), String(3 in fifth), String(7 in fifth), show(make()));
  const sixth = make();
  delete sixth[1];
  out.push(String(1 in sixth), show(make()));
  const seventh = make();
  Object.freeze(seventh);
  try { "use strict"; (seventh as unknown[])[0] = 1; } catch (error) { out.push((error as Error).constructor.name); }
  out.push(String(Object.isFrozen(seventh)), String(Object.isFrozen(make())));
  const eighth = make() as unknown[] & { extra?: number };
  eighth.extra = 5;
  out.push(String(eighth.extra), String((make() as unknown[] & { extra?: number }).extra));
  return out.join(" ");
}

function inLoop(rounds: number): number {
  let total = 0;
  const kept: number[][] = [];
  for (let i = 0; i < rounds; i++) {
    const list = [10, 20, 30];
    list[i % 3] += i;
    total += list[0] + list[1] + list[2];
    if (i % 100 === 0) kept.push(list);
  }
  return total + kept.length + kept[0][0] + kept[kept.length - 1][2];
}

function turnsIntoDoubles(): string {
  const list = [1, 2, 3];
  list[1] = 2.5;
  const other: unknown[] = [1, 2, 3];
  other[2] = "text";
  return show(list) + show(other) + show([1, 2, 3]);
}

for (const make of [integers, doubles, values, empty]) console.log(make.name, writes(make));
console.log(show(rarely(true)), show(rarely(false)), rarely(true) === rarely(true));
console.log(inLoop(1000), turnsIntoDoubles());
console.log(Array.isArray(integers()), integers().constructor === Array, Object.getPrototypeOf(doubles()) === Array.prototype, integers().concat(doubles()).length);
