function row(text: string, above: number[], first: number): number[] {
  const current: number[] = [first];
  for (let j = 1; j <= text.length; j++) current.push(Math.min(above[j] + 1, current[j - 1] + (text[j - 1] === "x" ? 0 : 1)));
  return current;
}
function lengths(text: string, above: number[], first: number): [number[], number] {
  const current: number[] = [first];
  let last = 0;
  for (let j = 1; j <= text.length; j++) last += current.push(above[j] * 0.5 + current[j - 1]);
  return [current, last];
}
function named(text: string, above: number[], first: number): number[] {
  const current: number[] = [first];
  for (let j = 1; j <= text.length; j++) {
    const length: number = current.push(above[j] - current[j - 1]);
    if (length > 1e9) break;
  }
  return current;
}
function twice(text: string, above: number[], first: number): number[] {
  const current: number[] = [first];
  for (let j = 1; j <= text.length; j++) {
    current.push(above[j] + current[j - 1]);
    current.push(-above[j]);
  }
  return current;
}
function aliased(text: string, above: number[], first: number): string {
  const current: number[] = [first];
  const other = current;
  for (let j = 1; j <= text.length; j++) {
    current.push(above[j] + current[j - 1]);
    if (j === 3) other.length = 2;
  }
  return current.join() + other.length;
}
function distance(a: string, b: string): number {
  let previous: number[] = [];
  for (let j = 0; j <= b.length; j++) previous.push(j);
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost));
    }
    previous = current;
  }
  return previous[b.length];
}
const texts: string[] = JSON.parse('["", "x", "axbxc", "kitten", "sitting on the bench in the garden", "é中x😀"]');
const lists: any[][] = JSON.parse('[[], [1, 2, 3, 4, 5, 6, 7, 8], [0.5, 1.5, -2.5], [null, "3", true, 4], [9007199254740993, 2147483648, -2147483649, 1e300]]');
const holes: number[] = [1, , 3] as number[];
lists.push(holes, [NaN, -0, Infinity, -Infinity], Array.from({ length: 60 }, (_, i) => i));
for (const text of texts) {
  for (const list of lists) {
    const said: string[] = [];
    for (const first of [0, -0, 1, 2.5, NaN, JSON.parse('"7"'), undefined as any]) {
      for (const f of [row, lengths, named, twice, aliased] as ((text: string, above: number[], first: number) => unknown)[]) {
        try {
          said.push(JSON.stringify(f(text, list, first)));
        } catch (error) {
          said.push((error as Error).constructor.name);
        }
      }
    }
    console.log(text.length, said.join("|").length, said.slice(0, 9).join("|").slice(0, 200));
    let hash = 0;
    for (const c of said.join("|")) hash = (Math.imul(hash, 31) + c.codePointAt(0)!) | 0;
    console.log(hash);
  }
}
for (const a of texts) console.log(texts.map(b => distance(a, b)).join());
