function makers(...values: number[]): (() => number)[] { const made: (() => number)[] = []; for (let i = 0; i < values.length; i++) made.push(() => values[i] * 10 + i); return made; }
function counters(...values: number[]): (() => number)[] { const made: (() => number)[] = []; for (let i = 0; i < values.length; i++) { let own = values[i]; made.push(() => ++own + i); } return made; }
function shared(): (() => number)[] { const made: (() => number)[] = []; for (var i = 0; i < 3; i++) made.push(() => i); return made; }
for (let turn = 0; turn < 3; turn++) {
  const first = makers(turn, 5, 6);
  const second = counters(turn, 5);
  console.log(first.map(f => f()).join(), second.map(f => f()).join(), second.map(f => f()).join(), shared().map(f => f()).join());
}
