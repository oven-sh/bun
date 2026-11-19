async function load(k: number): Promise<boolean> { return k > 100; }
const log: string[] = [];
async function isSmallSquare(k: number, slow: boolean) {
  const yes = await (slow ? load(k) : (k === 1 || k === 4 || k === 9));
  log.push("answer " + yes);
}
for (let i = 0; i < 300; i++) { isSmallSquare(i % 10, i % 50 === 49); log.push("behind"); }
await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
console.log(log.slice(0, 6).join(" | "), log.length);
