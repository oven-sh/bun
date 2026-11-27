const parts = JSON.parse('["#abcdefghijklmnop","b#defghijklmnopqr","","x#yzabcdefghijklm"]');
function* each(tail) {
  for (const part of parts) yield part + tail + part;
}
function total(from, tail) {
  const first = from & 1;
  let sum = from;
  for (const word of each(tail)) {
    for (let i = 0; i < word.length; i++) {
      const a = word.charCodeAt(i),
        b = word.charCodeAt(i + 1);
      if (word.charCodeAt(first) === 35) sum += 2;
      sum += a * 31 + (b | 0);
    }
  }
  return sum;
}
globalThis.kept = total;
for (let turn = 0; turn < 4; turn++) console.log(total(turn, String(turn).repeat(turn * 9)));
