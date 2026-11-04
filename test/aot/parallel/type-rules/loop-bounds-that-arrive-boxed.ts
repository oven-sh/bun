// A loop counts an int32 against a bound that arrives boxed: integers, fractions, -0, NaN, infinities, numbers beyond int32, with each relation and the bound on either side. The output is that of plain Bun.
const bounds: any[] = JSON.parse("[0, 1, 2, 5, -1, -5, 2.5, 4.000001, 3.999999, -0.5, 0.5, 2147483647, 2147483648, -2147483648, -2147483649, 1e10, -1e10, 4611686018427387904, -4611686018427387904, 1e300]");
bounds.push(-0, NaN, Infinity, -Infinity);

let bound: number = 0;
function setBound(value: any, depth: number): void { if (depth > 0) setBound(value, depth - 1); bound = value; }

const most = 8;
function below(): number { let turns = 0; const n = bound; for (let i = 0; i < n; i = (i + 1) | 0) { if (++turns >= most) break; } return turns; }
function atMost(): number { let turns = 0; const n = bound; for (let i = 0; i <= n; i = (i + 1) | 0) { if (++turns >= most) break; } return turns; }
function above(): number { let turns = 0; const n = bound; for (let i = 0; i > n; i = (i - 1) | 0) { if (++turns >= most) break; } return turns; }
function atLeast(): number { let turns = 0; const n = bound; for (let i = 0; i >= n; i = (i - 1) | 0) { if (++turns >= most) break; } return turns; }
function boundOnLeftAbove(): number { let turns = 0; const n = bound; for (let i = 0; n > i; i = (i + 1) | 0) { if (++turns >= most) break; } return turns; }
function boundOnLeftAtLeast(): number { let turns = 0; const n = bound; for (let i = 0; n >= i; i = (i + 1) | 0) { if (++turns >= most) break; } return turns; }
function boundOnLeftBelow(): number { let turns = 0; const n = bound; for (let i = 0; n < i; i = (i - 1) | 0) { if (++turns >= most) break; } return turns; }
function boundOnLeftAtMost(): number { let turns = 0; const n = bound; for (let i = 0; n <= i; i = (i - 1) | 0) { if (++turns >= most) break; } return turns; }
function nearTheTop(): number { let turns = 0; const n = bound; for (let i = 2147483645; i < n; i = (i + 1) | 0) { if (++turns >= most) break; } return turns; }

let lines: string[] = [];
for (let round = 0; round < 200; round++) {
  lines = [];
  for (const value of bounds) {
    setBound(value, 0);
    lines.push([below(), atMost(), above(), atLeast(), boundOnLeftAbove(), boundOnLeftAtLeast(), boundOnLeftBelow(), boundOnLeftAtMost(), nearTheTop()].join(" "));
  }
}
console.log(lines.join("\n"));
