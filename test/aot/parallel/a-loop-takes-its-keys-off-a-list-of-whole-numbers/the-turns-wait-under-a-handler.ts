// A loop takes its keys off a list of whole numbers under a handler of the program's own, and waits in each turn.
async function total(cells: number[], keys: number[]): Promise<string> {
  let sum = 0;
  let missed = 0;
  for (const key of keys) {
    try {
      const at = cells[key];
      if (at === undefined) throw new RangeError(String(key));
      sum += await at;
    } catch {
      missed++;
    }
  }
  return `${sum} ${missed}`;
}
const keys = [0, 1, 2, 3, 4].map(k => k * 2);
for (let round = 0; round < 3; round++) console.log(await total([10, 20, 30, 40, 50, 60], keys));
export {};
