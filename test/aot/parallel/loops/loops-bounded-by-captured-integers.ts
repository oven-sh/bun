// Loops whose bound is a captured variable that is a whole number, undefined, a fraction, a text or nothing, and which steps indexes beside the counter.
function meadow(columns?: any, rows?: any) {
  let across = columns;
  let down = rows;
  const cells: number[] = [];
  return {
    resize(newColumns: any, newRows: any) {
      across = newColumns;
      down = newRows;
    },
    fill(seed: number) {
      cells.length = 0;
      let cell = 0;
      for (let row = 0; row <= down; row++) {
        for (let column = 0; column <= across; column++)
          cells[cell++] = (seed + row * 3 + column) % 11;
      }
      return cell;
    },
    sumInside() {
      const stride = across + 1;
      let sum = 0;
      for (let row = 1; row < down; row++) {
        let above = (row - 1) * stride, here = row * stride;
        for (let column = 1; column < across; column++) {
          ++here;
          ++above;
          sum += cells[here] * 2 - cells[above];
        }
      }
      return sum;
    },
    countBelow(limit: any) {
      let count = 0;
      for (let cell = 0; cell < limit; cell += 2) {
        if (cells[cell] === undefined || ++count > 500)
          break;
      }
      return count;
    },
  };
}
function plot() {
  let wide: number | undefined, deep: number | undefined;
  const beds: number[] = [];
  return {
    plan(newWide: number, newDeep: number) {
      wide = newWide | 0;
      deep = newDeep | 0;
    },
    plant(seed: number) {
      let bed = 0;
      for (let row = 0; row <= deep!; row++) {
        for (let place = 0; place <= wide!; place++)
          beds[bed++] = (seed * 5 + row + place) % 9;
      }
      beds.length = bed;
      return bed;
    },
    weigh() {
      let weight = 0;
      for (let row = 1; row <= deep!; row++) {
        let here = row * (wide! + 1), before = here - wide! - 1;
        for (let place = 1; place <= wide!; place++) {
          ++here;
          weight += beds[here] - beds[++before] * 3;
        }
      }
      return weight;
    },
  };
}
const plots = [plot(), plot()];
(globalThis as any).plots = plots;
const planted: any[] = [plots[0].plant(1), plots[0].weigh()];
for (let turn = 0; turn < 120; turn++) {
  (globalThis as any).plots[turn & 1].plan(turn % 13, turn % 6 - 1);
  planted.push(plots[turn & 1].plant(turn), plots[turn & 1].weigh(), (globalThis as any).plots[1 - (turn & 1)].weigh());
}
console.log(planted.map(answer => Object.is(answer, -0) ? "-0" : String(answer)).join(" "));
const sizes: any[] = [[8, 5], [1, 1], [0, 0], [undefined, 4], [4, undefined], [6.5, 3], ["7", 3], [null, 2], [3, -1], [NaN, 2], [true, true], [5, { valueOf: () => 3 }]];
const asked = meadow(3, 3);
(globalThis as any).meadows = { asked };
for (const [columns, rows] of sizes) {
  const own = meadow(columns, rows);
  asked.resize(columns, rows);
  const answers: any[] = [];
  for (let turn = 0; turn < 30; turn++) {
    answers.length = 0;
    answers.push(own.fill(turn), own.sumInside(), own.countBelow(columns), asked.fill(turn + 1), asked.sumInside(), (globalThis as any).meadows.asked.countBelow(rows));
  }
  console.log(String(columns), typeof rows, answers.map(answer => Object.is(answer, -0) ? "-0" : String(answer)).join(" "));
}
