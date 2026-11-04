// An array gets hundreds of properties whose names are negative numbers, as the table of a diff algorithm does. It is still popped, pushed to, joined and read like any array.
function fill(count: number): number[] {
  const table: number[] = [1, 2, 3];
  for (let key = -count; key < 0; key++) table[key] = key;
  return table;
}

function use(table: number[]): string {
  const last = table.pop()!;
  table.push(last + 1);
  return `${table.length} ${table.join()} ${table[-1]} ${table[-2]} ${Object.keys(table).length}`;
}

for (const count of [0, 1, 128, 300, 1000]) console.log(count, use(fill(count)));

// Myers' algorithm keeps the furthest point it has reached on each diagonal under the number of that diagonal, and half of those numbers are negative.
function countEdits(from: string[], to: string[]): number {
  const furthest: number[] = [];
  furthest[1] = 0;
  const most = from.length + to.length;
  for (let edits = 0; edits <= most; edits++) {
    for (let diagonal = -edits; diagonal <= edits; diagonal += 2) {
      const goesDown = diagonal === -edits || (diagonal !== edits && furthest[diagonal - 1]! < furthest[diagonal + 1]!);
      let x = goesDown ? furthest[diagonal + 1]! : furthest[diagonal - 1]! + 1;
      let y = x - diagonal;
      while (x < from.length && y < to.length && from[x] === to[y]) {
        x++;
        y++;
      }
      furthest[diagonal] = x;
      if (x >= from.length && y >= to.length) return edits + furthest.pop()! * 0;
    }
  }
  return -1;
}

const left = Array.from({ length: 200 }, (_, index) => "left " + index);
const right = Array.from({ length: 200 }, (_, index) => "right " + index);
console.log(
  countEdits(left, right),
  countEdits(left, left),
  countEdits(left, [...left.slice(0, 100), "new", ...left.slice(101)]),
);
