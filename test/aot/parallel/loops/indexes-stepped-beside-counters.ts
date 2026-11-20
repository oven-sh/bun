// An index that each iteration steps beside the counter, or that the counter may replace. Where a list is shorter than the steps, the reads give undefined and the stores make it longer.
function everyThird(from: number[], count: number): number {
  let sum = 0;
  let at = -3;
  for (let i = 0; i < count; i++) {
    at += 3;
    sum = (sum * 5 + from[at]) % 65521;
  }
  return sum;
}

function raised(to: number[], from: number[], offset: number, count: number): number[] {
  let source = offset;
  let target = 0;
  for (let i = 0; i < count; i++) {
    to[target] = from[source++] + from[source] * 2;
    target += 1;
  }
  return to;
}

function lowestFrom(list: number[], start: number): number {
  let lowest = start;
  for (let i = start + 1; i < list.length; i++) if (list[i] < list[lowest]) lowest = i;
  return lowest;
}

function meeting(list: number[], count: number): number {
  let high = count;
  let difference = 0;
  for (let low = 0; low < count; low++) {
    high--;
    difference += list[low] * 2 - list[high];
  }
  return difference;
}

function stored(list: number[], step: number, count: number): number[] {
  let at = 0;
  for (let i = 0; i < count; i++) {
    list[at] = i * step;
    at += step;
  }
  return list;
}

function positionsOf(list: number[], wanted: number, count: number): number[] {
  const found: number[] = [];
  let at = -1;
  for (let i = 0; i < count; i++) if (list[++at] === wanted) found.push(at);
  return found;
}

const lists: Record<string, () => number[]> = {
  integers: () => Array.from({ length: 40 }, (_, i) => (i * 7) % 23),
  halves: () => Array.from({ length: 40 }, (_, i) => ((i * 5) % 17) / 2),
  largest: () => Array.from({ length: 40 }, (_, i) => 2147483647 - (i % 4)),
  negativeZeros: () => Array.from({ length: 40 }, (_, i) => (i % 3 ? i : -0)),
  short: () => [3, 1, 2],
  empty: () => [],
  holes: () => {
    const list = [9, 8, 7, 6, 5, 4, 3, 2, 1];
    delete list[4];
    return list;
  },
  late: () => {
    const list: number[] = [1, 2, 3, 4, 5, 6, 7, 8];
    (list as unknown[])[6] = "6";
    return list;
  },
};
const shown = (values: unknown[]) => values.map(value => (Object.is(value, -0) ? "-0" : String(value))).join(" ");

for (const [name, make] of Object.entries(lists)) {
  for (const count of [0, 1, 7, 8, 13, 41]) {
    console.log(
      name,
      count,
      everyThird(make(), count),
      meeting(make(), count),
      shown(raised([], make(), count % 5, count)),
      shown(positionsOf(make(), 7, count)),
      shown(Object.keys(stored(make(), (count % 3) + 1, count))),
    );
  }
  const list = make();
  const order: number[] = [];
  for (let start = 0; start < list.length; start++) order.push(lowestFrom(list, start));
  console.log(name, shown(order));
}
