// Async functions that keep many values alive across their awaits, so that their frames are large: every value is there again when the function goes on, after a real suspension, after an await that is settled already, and in a catch block.
let state = 12345;
function next(): number {
  state = (state * 1103515245 + 12345) % 2147483648;
  return state % 1000;
}
interface Box {
  value: number;
  text: string;
}
function box(): Box {
  const value = next();
  return { value, text: "b" + value };
}
function text(): string {
  return "t" + next();
}
function later<T>(value: T): Promise<T> {
  return new Promise<T>(resolve => setTimeout(() => resolve(value), 0));
}
function fails(reason: string): Promise<never> {
  return new Promise<never>((_, reject) => setTimeout(() => reject(new Error(reason)), 0));
}
function churn(): number {
  let kept = 0;
  for (let i = 0; i < 2000; i++) kept += [i, i + 1, { i }].length;
  return kept;
}
async function suspended(rounds: number): Promise<number> {
  const n0 = next();
  const s1 = text();
  const b2 = box();
  const n3 = next();
  const s4 = text();
  const b5 = box();
  const n6 = next();
  const s7 = text();
  const b8 = box();
  const n9 = next();
  const s10 = text();
  const b11 = box();
  const n12 = next();
  const s13 = text();
  const b14 = box();
  const n15 = next();
  const s16 = text();
  const b17 = box();
  const n18 = next();
  const s19 = text();
  const b20 = box();
  const n21 = next();
  const s22 = text();
  const b23 = box();
  const n24 = next();
  const s25 = text();
  const b26 = box();
  const n27 = next();
  const s28 = text();
  const b29 = box();
  const n30 = next();
  const s31 = text();
  const b32 = box();
  const n33 = next();
  const s34 = text();
  const b35 = box();
  const n36 = next();
  const s37 = text();
  const b38 = box();
  const n39 = next();
  const s40 = text();
  const b41 = box();
  const n42 = next();
  const s43 = text();
  const b44 = box();
  const n45 = next();
  const s46 = text();
  const b47 = box();
  const n48 = next();
  const s49 = text();
  const b50 = box();
  const n51 = next();
  const s52 = text();
  const b53 = box();
  const n54 = next();
  const s55 = text();
  const b56 = box();
  const n57 = next();
  const s58 = text();
  const b59 = box();
  const n60 = next();
  const s61 = text();
  const b62 = box();
  const n63 = next();
  const s64 = text();
  const b65 = box();
  const n66 = next();
  const s67 = text();
  const b68 = box();
  const n69 = next();
  const s70 = text();
  const b71 = box();
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    sum += await later(round);
    sum += churn();
    sum += n0 * 1 + s1.length * 2 + s1.charCodeAt(1) + b2.value * 3 + b2.text.length + n3 * 4 + s4.length * 5 + s4.charCodeAt(1) + b5.value * 6 + b5.text.length + n6 * 7 + s7.length * 8 + s7.charCodeAt(1) + b8.value * 9 + b8.text.length + n9 * 10 + s10.length * 11 + s10.charCodeAt(1) + b11.value * 12 + b11.text.length + n12 * 13 + s13.length * 14 + s13.charCodeAt(1) + b14.value * 15 + b14.text.length + n15 * 16 + s16.length * 17 + s16.charCodeAt(1) + b17.value * 18 + b17.text.length + n18 * 19 + s19.length * 20 + s19.charCodeAt(1) + b20.value * 21 + b20.text.length + n21 * 22 + s22.length * 23 + s22.charCodeAt(1) + b23.value * 24 + b23.text.length + n24 * 25 + s25.length * 26 + s25.charCodeAt(1) + b26.value * 27 + b26.text.length + n27 * 28 + s28.length * 29 + s28.charCodeAt(1) + b29.value * 30 + b29.text.length + n30 * 31 + s31.length * 32 + s31.charCodeAt(1) + b32.value * 33 + b32.text.length + n33 * 34 + s34.length * 35 + s34.charCodeAt(1) + b35.value * 36 + b35.text.length + n36 * 37 + s37.length * 38 + s37.charCodeAt(1) + b38.value * 39 + b38.text.length + n39 * 40 + s40.length * 41 + s40.charCodeAt(1) + b41.value * 42 + b41.text.length + n42 * 43 + s43.length * 44 + s43.charCodeAt(1) + b44.value * 45 + b44.text.length + n45 * 46 + s46.length * 47 + s46.charCodeAt(1) + b47.value * 48 + b47.text.length + n48 * 49 + s49.length * 50 + s49.charCodeAt(1) + b50.value * 51 + b50.text.length + n51 * 52 + s52.length * 53 + s52.charCodeAt(1) + b53.value * 54 + b53.text.length + n54 * 55 + s55.length * 56 + s55.charCodeAt(1) + b56.value * 57 + b56.text.length + n57 * 58 + s58.length * 59 + s58.charCodeAt(1) + b59.value * 60 + b59.text.length + n60 * 61 + s61.length * 62 + s61.charCodeAt(1) + b62.value * 63 + b62.text.length + n63 * 64 + s64.length * 65 + s64.charCodeAt(1) + b65.value * 66 + b65.text.length + n66 * 67 + s67.length * 68 + s67.charCodeAt(1) + b68.value * 69 + b68.text.length + n69 * 70 + s70.length * 71 + s70.charCodeAt(1) + b71.value * 72 + b71.text.length;
  }
  return sum;
}
async function settled(rounds: number): Promise<number> {
  const n0 = next();
  const s1 = text();
  const b2 = box();
  const n3 = next();
  const s4 = text();
  const b5 = box();
  const n6 = next();
  const s7 = text();
  const b8 = box();
  const n9 = next();
  const s10 = text();
  const b11 = box();
  const n12 = next();
  const s13 = text();
  const b14 = box();
  const n15 = next();
  const s16 = text();
  const b17 = box();
  const n18 = next();
  const s19 = text();
  const b20 = box();
  const n21 = next();
  const s22 = text();
  const b23 = box();
  const n24 = next();
  const s25 = text();
  const b26 = box();
  const n27 = next();
  const s28 = text();
  const b29 = box();
  const n30 = next();
  const s31 = text();
  const b32 = box();
  const n33 = next();
  const s34 = text();
  const b35 = box();
  const n36 = next();
  const s37 = text();
  const b38 = box();
  const n39 = next();
  const s40 = text();
  const b41 = box();
  const n42 = next();
  const s43 = text();
  const b44 = box();
  const n45 = next();
  const s46 = text();
  const b47 = box();
  const n48 = next();
  const s49 = text();
  const b50 = box();
  const n51 = next();
  const s52 = text();
  const b53 = box();
  const n54 = next();
  const s55 = text();
  const b56 = box();
  const n57 = next();
  const s58 = text();
  const b59 = box();
  const n60 = next();
  const s61 = text();
  const b62 = box();
  const n63 = next();
  const s64 = text();
  const b65 = box();
  const n66 = next();
  const s67 = text();
  const b68 = box();
  const n69 = next();
  const s70 = text();
  const b71 = box();
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    sum += await round;
    sum += await Promise.resolve(round);
    sum += n0 * 1 + s1.length * 2 + s1.charCodeAt(1) + b2.value * 3 + b2.text.length + n3 * 4 + s4.length * 5 + s4.charCodeAt(1) + b5.value * 6 + b5.text.length + n6 * 7 + s7.length * 8 + s7.charCodeAt(1) + b8.value * 9 + b8.text.length + n9 * 10 + s10.length * 11 + s10.charCodeAt(1) + b11.value * 12 + b11.text.length + n12 * 13 + s13.length * 14 + s13.charCodeAt(1) + b14.value * 15 + b14.text.length + n15 * 16 + s16.length * 17 + s16.charCodeAt(1) + b17.value * 18 + b17.text.length + n18 * 19 + s19.length * 20 + s19.charCodeAt(1) + b20.value * 21 + b20.text.length + n21 * 22 + s22.length * 23 + s22.charCodeAt(1) + b23.value * 24 + b23.text.length + n24 * 25 + s25.length * 26 + s25.charCodeAt(1) + b26.value * 27 + b26.text.length + n27 * 28 + s28.length * 29 + s28.charCodeAt(1) + b29.value * 30 + b29.text.length + n30 * 31 + s31.length * 32 + s31.charCodeAt(1) + b32.value * 33 + b32.text.length + n33 * 34 + s34.length * 35 + s34.charCodeAt(1) + b35.value * 36 + b35.text.length + n36 * 37 + s37.length * 38 + s37.charCodeAt(1) + b38.value * 39 + b38.text.length + n39 * 40 + s40.length * 41 + s40.charCodeAt(1) + b41.value * 42 + b41.text.length + n42 * 43 + s43.length * 44 + s43.charCodeAt(1) + b44.value * 45 + b44.text.length + n45 * 46 + s46.length * 47 + s46.charCodeAt(1) + b47.value * 48 + b47.text.length + n48 * 49 + s49.length * 50 + s49.charCodeAt(1) + b50.value * 51 + b50.text.length + n51 * 52 + s52.length * 53 + s52.charCodeAt(1) + b53.value * 54 + b53.text.length + n54 * 55 + s55.length * 56 + s55.charCodeAt(1) + b56.value * 57 + b56.text.length + n57 * 58 + s58.length * 59 + s58.charCodeAt(1) + b59.value * 60 + b59.text.length + n60 * 61 + s61.length * 62 + s61.charCodeAt(1) + b62.value * 63 + b62.text.length + n63 * 64 + s64.length * 65 + s64.charCodeAt(1) + b65.value * 66 + b65.text.length + n66 * 67 + s67.length * 68 + s67.charCodeAt(1) + b68.value * 69 + b68.text.length + n69 * 70 + s70.length * 71 + s70.charCodeAt(1) + b71.value * 72 + b71.text.length;
  }
  return sum;
}
async function caught(rounds: number): Promise<number> {
  const n0 = next();
  const s1 = text();
  const b2 = box();
  const n3 = next();
  const s4 = text();
  const b5 = box();
  const n6 = next();
  const s7 = text();
  const b8 = box();
  const n9 = next();
  const s10 = text();
  const b11 = box();
  const n12 = next();
  const s13 = text();
  const b14 = box();
  const n15 = next();
  const s16 = text();
  const b17 = box();
  const n18 = next();
  const s19 = text();
  const b20 = box();
  const n21 = next();
  const s22 = text();
  const b23 = box();
  const n24 = next();
  const s25 = text();
  const b26 = box();
  const n27 = next();
  const s28 = text();
  const b29 = box();
  const n30 = next();
  const s31 = text();
  const b32 = box();
  const n33 = next();
  const s34 = text();
  const b35 = box();
  const n36 = next();
  const s37 = text();
  const b38 = box();
  const n39 = next();
  const s40 = text();
  const b41 = box();
  const n42 = next();
  const s43 = text();
  const b44 = box();
  const n45 = next();
  const s46 = text();
  const b47 = box();
  const n48 = next();
  const s49 = text();
  const b50 = box();
  const n51 = next();
  const s52 = text();
  const b53 = box();
  const n54 = next();
  const s55 = text();
  const b56 = box();
  const n57 = next();
  const s58 = text();
  const b59 = box();
  const n60 = next();
  const s61 = text();
  const b62 = box();
  const n63 = next();
  const s64 = text();
  const b65 = box();
  const n66 = next();
  const s67 = text();
  const b68 = box();
  const n69 = next();
  const s70 = text();
  const b71 = box();
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    try {
      sum += await fails("r" + round);
    } catch (error) {
      sum += (error as Error).message.length;
      sum += n0 * 1 + s1.length * 2 + s1.charCodeAt(1) + b2.value * 3 + b2.text.length + n3 * 4 + s4.length * 5 + s4.charCodeAt(1) + b5.value * 6 + b5.text.length + n6 * 7 + s7.length * 8 + s7.charCodeAt(1) + b8.value * 9 + b8.text.length + n9 * 10 + s10.length * 11 + s10.charCodeAt(1) + b11.value * 12 + b11.text.length + n12 * 13 + s13.length * 14 + s13.charCodeAt(1) + b14.value * 15 + b14.text.length + n15 * 16 + s16.length * 17 + s16.charCodeAt(1) + b17.value * 18 + b17.text.length + n18 * 19 + s19.length * 20 + s19.charCodeAt(1) + b20.value * 21 + b20.text.length + n21 * 22 + s22.length * 23 + s22.charCodeAt(1) + b23.value * 24 + b23.text.length + n24 * 25 + s25.length * 26 + s25.charCodeAt(1) + b26.value * 27 + b26.text.length + n27 * 28 + s28.length * 29 + s28.charCodeAt(1) + b29.value * 30 + b29.text.length + n30 * 31 + s31.length * 32 + s31.charCodeAt(1) + b32.value * 33 + b32.text.length + n33 * 34 + s34.length * 35 + s34.charCodeAt(1) + b35.value * 36 + b35.text.length + n36 * 37 + s37.length * 38 + s37.charCodeAt(1) + b38.value * 39 + b38.text.length + n39 * 40 + s40.length * 41 + s40.charCodeAt(1) + b41.value * 42 + b41.text.length + n42 * 43 + s43.length * 44 + s43.charCodeAt(1) + b44.value * 45 + b44.text.length + n45 * 46 + s46.length * 47 + s46.charCodeAt(1) + b47.value * 48 + b47.text.length + n48 * 49 + s49.length * 50 + s49.charCodeAt(1) + b50.value * 51 + b50.text.length + n51 * 52 + s52.length * 53 + s52.charCodeAt(1) + b53.value * 54 + b53.text.length + n54 * 55 + s55.length * 56 + s55.charCodeAt(1) + b56.value * 57 + b56.text.length + n57 * 58 + s58.length * 59 + s58.charCodeAt(1) + b59.value * 60 + b59.text.length + n60 * 61 + s61.length * 62 + s61.charCodeAt(1) + b62.value * 63 + b62.text.length + n63 * 64 + s64.length * 65 + s64.charCodeAt(1) + b65.value * 66 + b65.text.length + n66 * 67 + s67.length * 68 + s67.charCodeAt(1) + b68.value * 69 + b68.text.length + n69 * 70 + s70.length * 71 + s70.charCodeAt(1) + b71.value * 72 + b71.text.length;
    }
  }
  return sum;
}
async function few(rounds: number): Promise<number> {
  const a = next();
  const b = box();
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += (await later(round)) + a + b.value;
  return sum;
}
async function nested(depth: number): Promise<number> {
  if (depth === 0) return suspended(2);
  const before = box();
  const inner = await nested(depth - 1);
  return inner + before.value;
}
console.log(await suspended(3));
console.log(await settled(3));
console.log(await caught(3));
console.log(await few(3));
console.log(await nested(4));
console.log((await Promise.all([suspended(2), caught(2), settled(2), few(2), suspended(1)])).join());
