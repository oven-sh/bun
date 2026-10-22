// Reads of one array around built-in writes to an array that may or may not be the same one.
function appendWhileReading(source: number[], target: number[], limit: number): number {
  let total = 0;
  for (let i = 0; i < source.length && i < limit; i++) {
    total += source[i];
    target.push(source[i] + 0.5);
    total += source[i] + source.length;
  }
  return total;
}

function popWhileReading(source: number[], target: number[]): number {
  let total = 0;
  for (let i = 0; i < source.length; i++) {
    total += source[i];
    target.pop();
    total += source.length;
  }
  return total;
}

interface Holder { list: (number | string)[] }

function changeStorageThroughHolder(list: (number | string)[], holder: Holder): string {
  let text = "";
  for (let i = 0; i < 3; i++) {
    text += list[0];
    holder.list.push("s" + i);
    text += list[list.length - 1];
    holder.list.unshift(i);
    text += list[0];
  }
  return text;
}

function fill(values: number[], extra: number): number[] {
  values.push(extra);
  return values;
}

function lengthAroundCall(values: number[]): number {
  const before = values.length + values[0];
  const other = fill(values, 7);
  return before * 100 + values.length * 10 + other.length + values[values.length - 1];
}

function spliceWhileReading(source: number[], target: number[]): number {
  let total = 0;
  for (let i = 0; i < source.length; i++) {
    total += source[i];
    target.splice(0, 1);
    total += source.length * 1000;
  }
  return total;
}

function mapsAndSets(first: Map<string, number>, second: Map<string, number>, seen: Set<number>, other: Set<number>): number {
  let total = 0;
  for (let i = 0; i < 4; i++) {
    total += first.size + (first.get("k" + i) ?? 0);
    second.set("k" + (i + 1), i);
    total += first.size + (first.get("k" + (i + 1)) ?? 0);
    total += seen.has(i) ? 1 : 0;
    other.add(i);
    total += seen.has(i) ? 10 : 0;
    other.delete(i - 1);
    total += seen.size * 100;
  }
  return total;
}

for (let round = 0; round < 300; round++) {
  const same = [1, 2, 3];
  const left = [1, 2, 3];
  const right = [4, 5, 6];
  const mixed: (number | string)[] = [1, 2];
  const map = new Map<string, number>();
  const set = new Set<number>();
  const lines = [
    appendWhileReading(same, same, 6),
    appendWhileReading(left, right, 6),
    popWhileReading([1, 2, 3, 4, 5, 6], [9, 9, 9]),
    (() => { const shared = [1, 2, 3, 4, 5, 6]; return popWhileReading(shared, shared); })(),
    changeStorageThroughHolder(mixed, { list: mixed }),
    changeStorageThroughHolder([5, 6], { list: [7] }),
    lengthAroundCall([3, 4]),
    (() => { const shared = [1, 2, 3, 4, 5, 6]; return spliceWhileReading(shared, shared); })(),
    spliceWhileReading([1, 2, 3], [4, 5, 6]),
    mapsAndSets(map, map, set, set),
    mapsAndSets(new Map(), new Map(), new Set(), new Set()),
  ];
  if (round === 0 || round === 299) console.log(lines.join(" | "));
}
