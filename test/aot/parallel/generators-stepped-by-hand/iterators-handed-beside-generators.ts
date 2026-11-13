function* count(length: number): Generator<number> {
  for (let index = 0; index < length; index++) yield index;
}

function sum(values: any, length: number): any {
  let result: any = 0;
  for (const value of count(length)) {
    if (value > 1) {
      for (const other of values) result += other;
      return result;
    }
    result += value;
  }
  return result;
}

let state = 1;
function twice(value: any): any {
  state = (state + 1) & 7;
  return value;
}

function sumOfValues(map: Map<any, any>, length: number): any {
  const a = twice(length) - 1;
  const b = twice(a) - 2;
  const c = twice(b) * 3;
  const d = twice(c) | 1;
  const e = twice(d) - 7;
  const f = twice(e) ^ 2;
  const g = twice(f) - 3;
  if (a + b + c + d + e + f + g === 12345) return 0;
  return sum(map.values(), length);
}

for (const length of [0, 1, 4])
  console.log(
    sumOfValues(
      new Map<any, any>([
        [1, 2],
        [3, 4],
      ]),
      length,
    ),
  );

function firstAbove(generator: any, list: number[], bound: number): any {
  for (const value of generator) {
    const found = list[value];
    if (value > bound) return found;
  }
  return -1;
}

for (const bound of [0, 1, 7]) console.log(firstAbove(count(4), [1.5, 2], bound), 1 + firstAbove(count(4), [1, , 3] as number[], bound), firstAbove(count(2), [3], bound) + "s");
