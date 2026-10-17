// Two operations on one Map or Set with one number key, one behind the other: read then write, ask then read, ask then add, read then remove. Every pair runs beside a model made of two arrays. Between the two operations the table is left alone, or changed in every way there is: then the second may not trust what the first found.
const report: string[] = [];
function isSameKey(a: number, b: number): boolean {
  return a === b || (a !== a && b !== b);
}
class Model {
  readonly keys: number[] = [];
  readonly values: number[] = [];
  indexOf(key: number): number {
    for (let i = 0; i < this.keys.length; i++) if (isSameKey(this.keys[i]!, key)) return i;
    return -1;
  }
  put(key: number, value: number): void {
    const at = this.indexOf(key);
    if (at >= 0) this.values[at] = value;
    else {
      this.keys.push(key === 0 ? 0 : key);
      this.values.push(value);
    }
  }
  drop(key: number): void {
    const at = this.indexOf(key);
    if (at < 0) return;
    this.keys.splice(at, 1);
    this.values.splice(at, 1);
  }
  show(): string {
    return this.keys.map((key, i) => key + ">" + this.values[i]).join(" ");
  }
}
function show(table: Map<number, number>): string {
  const parts: string[] = [];
  table.forEach((value, key) => parts.push((Object.is(key, -0) ? "minus zero" : key) + ">" + value));
  return parts.join(" ");
}

const kinds: number[][] = [
  [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9],
  [0, -0, 0.5, -0.5, 0, 1.5, -0, 0.5],
  [NaN, 1, NaN, Infinity, -Infinity, Infinity, NaN],
  [2147483647, 2147483648, -2147483648, -2147483649, 2147483647, 4294967296, 2147483648, 1e21, 5e-324, 1e21],
];
const many: number[] = [];
for (let row = 0; row < 23; row++) for (let column = 0; column < 17; column++) many.push((row * column) % 61 - 12);
kinds.push(many, many.map(key => key / 4));

function raise(table: Map<number, number>, key: number, by: number): void {
  const old = table.get(key);
  table.set(key, old === undefined ? by : old + by);
}
function raiseInOneExpression(table: Map<number, number>, key: number, by: number): number {
  return table.set(key, by + (table.get(key) ?? 100)).size;
}
function doubled(table: Map<number, number>, key: number): number {
  return table.has(key) ? table.get(key)! * 2 : -1;
}
function enter(members: Set<number>, key: number): boolean {
  if (members.has(key)) return false;
  members.add(key);
  return true;
}
function settle(table: Map<number, number>, key: number, value: number): number {
  let held = table.get(key);
  if (held === undefined) table.set(key, (held = value));
  return held;
}
function take(table: Map<number, number>, key: number): number {
  const held = table.get(key);
  table.delete(key);
  return held === undefined ? -7 : held;
}

let disagreements = 0;
for (const keys of kinds) {
  const table = new Map<number, number>();
  const model = new Model();
  const members = new Set<number>();
  let entered = 0;
  let checks = 0;
  for (let turn = 0; turn < 4; turn++)
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      const at = model.indexOf(key);
      switch ((i + turn) % 5) {
        case 0:
          raise(table, key, turn + 1);
          model.put(key, at < 0 ? turn + 1 : model.values[at]! + turn + 1);
          break;
        case 1:
          raiseInOneExpression(table, key, i);
          model.put(key, i + (at < 0 ? 100 : model.values[at]!));
          break;
        case 2:
          if (doubled(table, key) !== (at < 0 ? -1 : model.values[at]! * 2)) disagreements++;
          break;
        case 3:
          if (settle(table, key, i * 3) !== (at < 0 ? i * 3 : model.values[at]!)) disagreements++;
          if (at < 0) model.put(key, i * 3);
          break;
        default:
          if (take(table, key) !== (at < 0 ? -7 : model.values[at]!)) disagreements++;
          model.drop(key);
      }
      if (enter(members, key)) entered++;
      if (show(table) !== model.show()) disagreements++;
      checks++;
    }
  report.push(checks + " " + entered + " " + members.size + " " + table.size + " | " + show(table).slice(0, 90));
}
report.push("disagreements " + disagreements);

function swell(table: Map<number, number>, from: number): void {
  for (let i = 0; i < 37; i++) table.set(from - i, i);
}
function between(keys: number[]): string {
  const table = new Map<number, number>();
  const sameTable = table;
  const log: number[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const a = table.get(key);
    swell(table, -1000 - i * 37);
    table.set(key, a === undefined ? 1 : a + 1);

    const b = table.get(key);
    sameTable.delete(key);
    table.set(key, b === undefined ? 10 : b + 10);

    if (table.has(key)) {
      sameTable.delete(key);
      log.push(table.get(key) === undefined ? 0 : 1);
    }
    const c = table.get(key);
    sameTable.set(key, 40);
    table.set(key, (c ?? 2) + (table.get(key) ?? 3));

    if (!table.has(key + 0.125)) {
      sameTable.clear();
      table.set(key + 0.125, i);
      log.push(table.size);
    }
    const d = table.get(key + 0.125);
    for (let j = 0; j < 3; j++) {
      table.set(key + 0.125, (d ?? 0) + j);
      if (j === 1) table.delete(key + 0.125);
      swell(table, 5000 + j);
    }
    log.push(table.get(key + 0.125) ?? -1, table.size);
  }
  return log.join();
}
report.push(between([5, 6, 5, 0, -0, 7.5, NaN, 5]));

class Meddling extends Map<number, number> {
  asked = 0;
  get(key: number): number | undefined {
    if (++this.asked % 3 === 0) super.delete(key);
    return super.get(key);
  }
  set(key: number, value: number): this {
    return super.set(key, -value);
  }
}
function throughAnyTable(table: Map<number, number>, keys: number[]): string {
  for (const key of keys) raise(table, key, 2);
  return show(table);
}
report.push(throughAnyTable(new Map(), kinds[0]!), throughAnyTable(new Meddling(), kinds[0]!));

function leavesHalfway(keys: number[]): string {
  const table = new Map<number, number>();
  let left = 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    try {
      const old = table.get(key);
      if (i % 4 === 1) {
        table.delete(key);
        throw new RangeError(String(key));
      }
      table.set(key, old === undefined ? 1 : old + 1);
    } catch {
      left++;
      raise(table, key, 50);
    }
  }
  return left + " | " + show(table);
}
report.push(leavesHalfway(kinds[0]!), leavesHalfway(kinds[1]!));
console.log(report.join("\n"));
