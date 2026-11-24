const show = (v: unknown): string => typeof v === "function" ? "fn:" + v.name : typeof v === "symbol" ? String(v) : typeof v === "bigint" ? v + "n" : v === undefined ? "undefined" : JSON.stringify(v, (k: string, x: unknown) => typeof x === "function" ? "fn:" + x.name : typeof x === "bigint" ? x + "n" : x === undefined ? "undef" : x);
const said = (e: any): string => "THROWS " + (e && e.name) + (e && e.code ? " " + e.code : "") + (e && /\(bun compile/.test(String(e.message)) ? " [--aot: " + String(e.message).split(" (bun")[0]!.slice(0, 110) + "]" : "");
const t = (name: string, f: () => unknown): void => { try { console.log(name, show(f())); } catch (e) { console.log(name, said(e)); } };
const ta = async (name: string, f: () => unknown): Promise<void> => { try { console.log(name, show(await f())); } catch (e) { console.log(name, said(e)); } };
const keys = (o: object): string => Object.keys(o).filter((k) => k !== "__esModule").sort().join();
function murmur3(text: string, seed: number): number {
  const bytes = Array.from(text, (letter) => letter.charCodeAt(0) & 255), whole = bytes.length - bytes.length % 4;
  const scrambled = (word: number): number => { word = Math.imul(0xcc9e2d51, word); return Math.imul(word << 15 | word >>> 17, 0x1b873593); };
  let sum = seed, rest = 0;
  for (let at = 0; at < whole; at += 4) {
    let word = 0;
    for (let k = 3; k >= 0; k--) word = word << 8 | bytes[at + k]!;
    sum ^= scrambled(word);
    sum = Math.imul(sum << 13 | sum >>> 19, 5) + 0xe6546b64 | 0;
  }
  for (let at = bytes.length; at > whole; at--) rest = rest << 8 | bytes[at - 1]!;
  if (whole < bytes.length) sum ^= scrambled(rest);
  sum ^= bytes.length;
  for (const [by, factor] of [[16, 0x85ebca6b], [13, 0xc2b2ae35]] as [number, number][]) sum = Math.imul(sum ^ sum >>> by, factor);
  return (sum ^ sum >>> 16) >>> 0;
}
function imulByHand(a: number, b: number): number { const low = (a & 65535) * (b | 0), high = (a >>> 16) * (b & 65535) % 65536; return high * 65536 + low | 0; }
function xorshift32(seed: number, n: number): number[] { const drawn: number[] = []; for (let state = seed; drawn.length < n; drawn.push(state >>> 0)) { state = state ^ state << 13; state = state ^ state >>> 17; state = state ^ state << 5; } return drawn; }
function stirred(seed: number, n: number): number[] { const drawn: number[] = []; let state = seed; while (drawn.length < n) { state = state + 701408733 | 0; let word = Math.imul(state ^ state >>> 11, 433494437); word ^= word >>> 9; word = Math.imul(word, 267914297) + state | 0; drawn.push((word >>> 1) / 2147483648); } return drawn; }
function lcg(seed: number, n: number): number[] { const drawn: number[] = []; for (let state = seed; n > 0; n--) { state = (12345 + 1103515245 * state) % 2147483648; drawn.push(state); } return drawn; }
function park(seed: number, n: number): number[] { const drawn: number[] = []; for (let state = seed; n > 0; n--) { state = 16807 * state % 2147483647; drawn.push(state); } return drawn; }
function run(): unknown { return [murmur3("hello, world", 0), murmur3("abc", 0x9747b28c), murmur3("", 1), imulByHand(0xffffffff, 5), imulByHand(0x7fffffff, 0x7fffffff), Math.imul(0xffffffff, 5), xorshift32(2463534242, 4), stirred(1, 3), lcg(42, 4), park(1, 5)]; }
for (const x of run() as unknown[]) console.log(show(x));
