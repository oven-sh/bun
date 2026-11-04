// `index in list` in front of `list[index]` in typed code: present, absent, past the end, a hole, an element that is undefined, a list that shrinks or loses an element between the question and the read.
function walk(list: (number | undefined)[], limit: number): string {
  let sum = 0,
    absent = 0;
  for (let k = 0; k < limit; k++) {
    if (k in list) sum += list[k]! + 1;
    else absent++;
  }
  return sum + "|" + absent;
}
function each<T>(list: T[], callback: (value: T) => void): void {
  for (let k = 0; k < list.length; k++) if (k in list) callback(list[k]!);
}
function total(list: number[]): string {
  let calls = 0,
    sum = 0;
  each(list, value => {
    calls++;
    sum += value;
  });
  return calls + ":" + sum;
}
function shrinks(list: number[]): string {
  let sum = 0,
    absent = 0;
  for (let k = 0; k < 4; k++) {
    if (k in list) {
      if (k === 1) list.length = 1;
      sum += list[k] ?? 100;
    } else absent++;
  }
  return sum + "|" + absent;
}
function loses(list: number[]): string {
  let sum = 0,
    absent = 0;
  for (let k = 0; k < 3; k++) {
    if (k in list) {
      if (k === 1) delete list[1];
      sum += list[k] ?? 100;
    } else absent++;
  }
  return sum + "|" + absent;
}
function weights(list: { weight: number }[]): string {
  let sum = 0,
    count = 0;
  list.forEach(entry => {
    sum += entry.weight;
    count++;
  });
  return sum + "/" + count;
}
const nothing = (): undefined => undefined;
const out: string[] = [];
for (let round = 0; round < 4; round++) {
  const fractions: number[] = [1.5, 2.5, 3.5];
  const withUndefined: (number | undefined)[] = [1.5, nothing(), 3.5];
  const holes: (number | undefined)[] = [1.5, , 3.5];
  const pushed: (number | undefined)[] = [];
  pushed.push(0.5);
  pushed.push(nothing());
  pushed.push(2.5);
  out.push(
    [walk(fractions, 4), walk(withUndefined, 4), walk(holes, 4), walk(pushed, 4), walk([], 2), walk([1, 2], 1)].join(
      " ",
    ),
  );
  const loose: any[] = [1.5, undefined, 3.5];
  const parsed: number[] = JSON.parse("[1.5,null,2.5]");
  out.push(
    [
      total(fractions),
      total(loose),
      total([1.5, NaN, 3.5]),
      total(parsed),
      total([1, , 3] as number[]),
      total([]),
    ].join(" "),
  );
  out.push([shrinks([1, 2, 3, 4]), shrinks([0.5, 1.5, 2.5]), loses([1, 2, 3]), loses([0.5, 1.5, 2.5])].join(" "));
  out.push(
    [
      weights([{ weight: 1 }, { weight: 2.5 }]),
      weights([]),
      weights([{ weight: round }, , { weight: 2 }] as { weight: number }[]),
    ].join(" "),
  );
}
console.log(out.join("\n"));
