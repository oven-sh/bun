const lines: string[] = [];

class Point {
  get sum(): number {
    return 1;
  }
}

function* scaled(count: number, list: number[], point: Point): Generator<number, any> {
  for (let index = 0; index < count; index++) yield Math.imul(list[index & 3], 3);
}

function join(count: number, list: number[], point: Point): string {
  let text = "x";
  for (const value of scaled(count, list, point)) text += value;
  return text;
}

function hash(count: number, list: number[], point: Point): number {
  let result = 7;
  for (const value of scaled(count, list, point)) result = (Math.imul(result, 31) + value) | 0;
  return result;
}

for (const count of [0, 1, 3, 8]) {
  const lists = [[1, 4], [1.5, 4], [1, 2, 3, 4], [], [1, 2, 3.5, 4]];
  for (const list of lists) {
    const point = new Point();
    lines.push(`${count} ${join(count, list, point)} ${hash(count, list, point)}`);
  }
}

function* each(list: any, count: number): Generator<any> {
  for (let index = 0; index < count; index++) yield list[index];
}

function joinAny(list: any, count: number): string {
  let text = "";
  let number = 1;
  for (const value of each(list, count)) {
    text += value;
    number = number * 3 + text.length;
  }
  return text + ":" + number;
}

for (const list of [[1, 4], [1.5, 4], ["a", 2], new Uint8Array([3, 4]), "text", { 0: 5, 1: 6 }])
  for (const count of [0, 1, 4]) lines.push(joinAny(list, count));

for (const text of lines) console.log(text);
