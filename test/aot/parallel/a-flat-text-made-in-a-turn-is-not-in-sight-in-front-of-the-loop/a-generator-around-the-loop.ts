const listed: string[] = JSON.parse('["#abc","b#d","","x#y"]');
const scores: number[] = JSON.parse('[0.5,1.5,2.5,3.5,4.5]');
function* each(): Generator<string> {
  for (const word of listed) yield word;
}
function total(from: number): number {
  const first = from & 1;
  let sum = from;
  for (const word of each()) {
    for (let i = 0; i < word.length; i++) {
      const a = word.charCodeAt(i),
        b = word.charCodeAt(i + 1);
      if (word.charCodeAt(first) === 35) sum += 2;
      sum += a * 31 + (b | 0) + scores[i]! * 2;
    }
  }
  return sum;
}
(globalThis as any).kept = total;
for (let turn = 0; turn < 4; turn++) console.log(total(turn));
export {};
