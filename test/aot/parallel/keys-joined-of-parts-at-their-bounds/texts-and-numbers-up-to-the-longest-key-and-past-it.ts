const seen = new Map<string, number>();
const held: Record<string, number> = {};
function count(front: string, first: number, second: number, back: string): string {
  const key = `${front}${first},${second}${back}`;
  seen.set(key, (seen.get(key) ?? 0) + 1);
  return key;
}
function countPair(first: number, second: number): string {
  const key = first + "," + second;
  seen.set(key, (seen.get(key) ?? 0) + 1);
  return key;
}
function hold(left: string, right: string): number {
  const key = left + right;
  held[key] = (held[key] ?? 0) + 1;
  return held[key];
}
const numbers = [0, 7, 10, 99, 100, 9999, 10000, 12345, 99999999, 100000000, 2147483647, -1, -9999, -10000, -2147483648];
const out: string[] = [];
for (let round = 0; round < 3; round++) {
  for (let length = 0; length <= 70; length += length < 36 ? 9 : 1) {
    const front = "f".repeat(length);
    for (const first of numbers) {
      const key = count(front, first, numbers[(length + round) % numbers.length], length % 3 === 0 ? "" : length % 3 === 1 ? ":b" : ":bc");
      if (round === 2 && (first === -2147483648 || first === 7)) out.push(key.length + ":" + key.slice(-24) + ":" + seen.get(key));
    }
  }
  for (const first of numbers) for (const second of numbers) countPair(first, second);
  for (const [left, right] of [["1", "2"], ["0", "1"], ["", "12"], ["12", ""], ["4294967", "295"], ["4294967", "294"], ["2147483", "648"], ["1", "x"], ["x", "1"], ["-", "1"], ["é", "1"], ["世", "1"], ["a".repeat(17), "b".repeat(16)], ["a".repeat(32), "b".repeat(32)], ["a".repeat(32), "b".repeat(33)]])
    out.push(left.length + "+" + right.length + ":" + hold(left, right));
}
console.log(out.join("\n"));
console.log(seen.size, seen.get("-2147483648,-2147483648"), seen.get("0,0"), Object.keys(held).join("|").length, Object.keys(held).slice(0, 6).join("|"));
