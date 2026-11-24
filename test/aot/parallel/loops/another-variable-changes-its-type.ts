// Counters of loops in which another variable does not keep the type that it enters with.
type Shelf = { labels: string[]; weights: Float64Array };

function shelf(count: number, heaviest: number): Shelf {
  const labels = Array.from({ length: count }, (_, k) => "jar " + ((k * 5) % 7));
  return { weights: Float64Array.from(labels, (_, k) => (heaviest * k) / count), labels };
}

function poured(left: Shelf, right: Shelf, told: (label: string, weight: number) => void): number | string {
  let seen: number | string = 0, i = 0;
  for (let k = 0; i + k < left.labels.length + right.labels.length;) {
    const isEmpty = i === left.labels.length;
    if (isEmpty || (k < right.labels.length && right.weights[k]! < left.weights[i]!)) told(right.labels[k]!, right.weights[k++]!);
    else told(left.labels[i]!, left.weights[i++]!);
    if ((i + k) % 9 === 8) seen = `${i}:${k}`;
    else seen = typeof seen === "string" ? i : seen + 1;
  }
  return seen;
}

function down(weights: Float64Array, from: number, by: number): string {
  let steps = 0, before: number | null = 0;
  for (let at = from; at >= 0; at -= by, steps++) {
    if (before === null) before = 0;
    else before = weights[at]! > before ? weights[at]! / 2 : null;
  }
  return steps + "/" + before;
}

const first = shelf(40, 64), second = shelf(17, 48.5);
const found: string[] = [];
console.log(poured(first, second, (label, weight) => { if (weight % 3 < 1) found.push(label + weight.toFixed(2)); }), found.length, found.join(" "));
console.log(poured(second, shelf(0, 1), () => {}), poured(shelf(3, 9), second, () => {}), down(first.weights, 39, 2), down(second.weights, 16, 3), down(first.weights, -1, 1), down(first.weights, 12, 12));

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
