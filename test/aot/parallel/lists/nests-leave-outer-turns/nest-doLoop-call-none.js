let seen = [];
function note(x) { seen.push('n' + String(x)); }
class Board {
  constructor(cells) { this.cells = cells; this.n = 0; this.marks = [0, 0, 0, 0, 0, 0, 0, 0]; }
  walk(square, steps) {
    let total = 0, turns = 0;
    for (const step of steps) { let at = square; note(step); do { at = at + step; total += this.cells[at] ? 1 : 2; } while (at < 30 && turns++ < 300);  }
    return total + '/' + turns;
  }
}
const makers = { ints: () => Array.from({ length: 40 }, (_, i) => (i * 7) % 5), doubles: () => Array.from({ length: 40 }, (_, i) => i % 4 ? i / 2 : 0), zeros: () => new Array(40).fill(0), holes: () => (() => { const l = new Array(40).fill(0); delete l[9]; l[20] = 3; return l; })(), strings: () => Array.from({ length: 40 }, (_, i) => i % 3 ? 0 : 'x' + i), objects: () => Array.from({ length: 40 }, (_, i) => i % 3 ? 0 : { valueOf() { seen.push('v' + i); return i; } }), accessor: () => (() => { const l = new Array(40).fill(0); Object.defineProperty(l, 12, { get() { seen.push('get'); return 2; } }); return l; })(), short: () => [0, 0, 1], none: () => [], bytes: () => new Uint8Array(40) };
const ways = { ints: () => ([-5, 3, 1, 7]), doubles: () => ([0.5, 2, 1.5]), mixed: () => ([1, undefined, 3]), texts: () => (['1', 2]), big: () => ([2147483647, 1, -2147483648]), holes: () => ([2, , 4]), objects: () => ([{ valueOf() { seen.push('s'); return 3; } }, 2]), custom: () => ({ *[Symbol.iterator]() { seen.push('i'); yield 2; seen.push('j'); yield 3; } }), none: () => ([]) };
for (let round = 0; round < 3; round++) for (const [n, make] of Object.entries(makers)) for (const [w, way] of Object.entries(ways)) for (const square of [4, 0.5, -3, undefined, "2", 2147483640]) {
  const board = new Board(make());
  let said;
  try { said = board.walk(square, way()); } catch (e) { said = e.constructor.name; }
  if (round !== 1) { console.log(n, w, String(square), said, board.n, board.marks.join(), seen.splice(0).join().slice(0, 120)); }
  seen = [];
}
