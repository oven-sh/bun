// A field is filled on the first iteration and read by the loops behind it.
const report: any = { first: null, second: undefined };

function fill(list: number[], height: number, width: number): number {
  let row = width;
  let total = 0;
  for (let i = 1; i < height; i++) {
    report.first ??= list[i] > 99;
    let at = row;
    let sum = 0;
    for (let j = 1; j < width; j++) {
      sum += list[at];
      at++;
    }
    row += width;
    total += sum;
  }
  return total + row;
}

for (const [height, width] of [[9, 12], [14, 5], [2, 7], [1, 3]]) {
  const list: number[] = [];
  for (let i = 0; i < height * width; i++) list.push(((i * 7) % 16) / 8 + 0.125);
  report.first = height > 8 ? null : 3;
  console.log(fill(list, height, width), JSON.stringify(report));
}

export {};
