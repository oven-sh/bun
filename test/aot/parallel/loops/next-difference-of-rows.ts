// Counters of loops in which another variable does not keep the type that it enters with.
type Cell = { char: string; style: number };
type Screen = { width: number; height: number; cells: Int32Array; chars: string[] };

function findNextDifference(a: Int32Array, b: Int32Array, word: number, count: number): number {
  for (let i = 0; i < count; i++, word += 2) {
    const second = word | 1;
    if (a[word] !== b[word] || a[second] !== b[second]) return i;
  }
  return count;
}

function readCell(screen: Screen, word: number, out: Cell): void {
  out.char = screen.chars[screen.cells[word]!] ?? " ";
  out.style = screen.cells[word | 1]! >> 2;
}

function compareRow(prev: Screen, next: Screen, word: number, y: number, endX: number, a: Cell, b: Cell, visit: (x: number, y: number, a: Cell, b: Cell) => boolean): boolean {
  let x = 0;
  while (x < endX) {
    const skip = findNextDifference(prev.cells, next.cells, word, endX - x);
    x += skip;
    word += skip << 1;
    if (x >= endX) break;
    readCell(prev, word, a);
    readCell(next, word, b);
    if (visit(x, y, a, b)) return true;
    x++;
    word += 2;
  }
  return false;
}

function makeScreen(width: number, height: number): Screen {
  return { width, height, cells: new Int32Array(width * height * 2), chars: [" ", "a", "b", "c"] };
}

const prev = makeScreen(40, 6), next = makeScreen(40, 6);
for (let i = 0; i < next.cells.length; i += 7) next.cells[i] = i % 5;
const found: string[] = [];
const a: Cell = { char: " ", style: 0 }, b: Cell = { char: " ", style: 0 };
for (let y = 0; y < 6; y++) compareRow(prev, next, y * 80, y, 40, a, b, (x, y, a, b) => (found.push(`${x},${y}${a.char}${b.char}${b.style}`), x + y > 41));
console.log(found.length, found.join(" "));

function fractions(step: number, n: number): string {
  let sum = 0, at = 0, texts: any = 0;
  for (let i = 0; i < n; i++) {
    sum = sum + step;
    at += 3;
    if (at > 1000) at = -5;
    if (i === n - 2) texts = "t" + at;
    else texts = texts + 1;
  }
  return `${sum} ${at} ${texts}`;
}
console.log(fractions(1, 10), fractions(0.5, 1000), fractions(-1e9, 12), fractions(2 ** 31, 5));

function wraps(start: number, n: number): string {
  let counter = start, other: number | undefined, last: unknown = 0;
  for (let i = 0; i < n; i++) {
    counter = counter + 1;
    other = other === undefined ? i : other * 1.5;
    if (counter === 2147483648) last = [counter];
    else last = other;
  }
  return JSON.stringify([counter, other, last]);
}
console.log(wraps(0, 4), wraps(2147483645, 4), wraps(2147483646, 3), wraps(-3, 6), wraps(4294967294, 4));

function inner(rows: number[][], limit: number): string {
  let total = 0, deepest: number | null = null, steps = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    for (let j = 0, k = row.length - 1; j <= k; j++, k--) {
      steps++;
      total += row[j]! - row[k]!;
      if (total > limit) deepest = total / 2;
    }
  }
  return `${total} ${deepest} ${steps}`;
}
console.log(inner([[1, 2, 3], [9, 4], [], [2.5, 1, 7, 3]], 3), inner([[5, 1], [8, 2, 1]], 1));
