const show = (v: unknown): string => typeof v === "function" ? "fn:" + v.name : typeof v === "symbol" ? String(v) : typeof v === "bigint" ? v + "n" : v === undefined ? "undefined" : JSON.stringify(v, (k: string, x: unknown) => typeof x === "function" ? "fn:" + x.name : typeof x === "bigint" ? x + "n" : x === undefined ? "undef" : x);
const said = (e: any): string => "THROWS " + (e && e.name) + (e && e.code ? " " + e.code : "") + (e && /\(bun compile/.test(String(e.message)) ? " [--aot: " + String(e.message).split(" (bun")[0]!.slice(0, 110) + "]" : "");
const t = (name: string, f: () => unknown): void => { try { console.log(name, show(f())); } catch (e) { console.log(name, said(e)); } };
const ta = async (name: string, f: () => unknown): Promise<void> => { try { console.log(name, show(await f())); } catch (e) { console.log(name, said(e)); } };
const keys = (o: object): string => Object.keys(o).filter((k) => k !== "__esModule").sort().join();
function mul(a: number[], b: number[]): number[] { // limbs of 26 bits, multiplied by their halves
  const sums: number[] = Array.from({ length: a.length + b.length }, () => 0);
  a.forEach((x, i) => {
    let over = 0;
    b.forEach((y, j) => {
      const low = Math.imul(y & 8191, x & 8191), cross = Math.imul(y >>> 13, x & 8191) + Math.imul(y & 8191, x >>> 13);
      const all = over + low + sums[i + j]! + (cross & 8191) * 8192;
      over = Math.floor(all / 67108864) + Math.imul(y >>> 13, x >>> 13) + (cross >>> 13);
      sums[i + j] = all & 67108863;
    });
    sums[i + b.length] = over + sums[i + b.length]!;
  });
  return sums;
}
function mulDouble(a: number[], b: number[]): number[] { // limbs of 16 bits, multiplied as fractions
  const sums: number[] = [];
  for (let at = 0, over = 0; at < a.length + b.length; at++) {
    let all = over;
    for (let i = Math.max(0, at - b.length + 1); i < a.length && i <= at; i++) all += b[at - i]! * a[i]!;
    over = Math.floor(all / 65536);
    sums.push(all - 65536 * over);
  }
  return sums;
}
function toBig(limbs: number[], bits: number): string { let whole = 0n; for (const limb of limbs.slice().reverse()) whole = BigInt(limb) | whole << BigInt(bits); return whole.toString(16); }
function settled(limbs: number[]): number[] { // what is over goes to the next limb, and what is over at the end to the first, 38 times
  let over = 0;
  for (let i = 0; i < limbs.length; i++) { const all = over + limbs[i]!, low = (all % 65536 + 65536) % 65536; limbs[i] = low; over = (all - low) / 65536; }
  limbs[0] = limbs[0]! + 38 * over;
  return limbs;
}
function run(): unknown { const a = [0x3ffffff, 0x3fffffe, 0x1234567, 0x2abcdef], b = [0x3ffffff, 0x0000001, 0x3ffffff]; const c = [65535, 65535, 1, 65534], d = [65535, 65535, 65535]; return [toBig(mul(a, b), 26), (BigInt("0x" + toBig(a, 26)) * BigInt("0x" + toBig(b, 26))).toString(16), toBig(mulDouble(c, d), 16), (BigInt("0x" + toBig(c, 16)) * BigInt("0x" + toBig(d, 16))).toString(16), settled([70000, -5, 65536, 1e9, -1e9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 131072])]; }
for (const x of run() as unknown[]) console.log(show(x));
