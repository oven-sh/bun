const listed = JSON.parse('["#abc","b","","x#","#"]');
function* each() {
  for (const word of listed) yield word;
}
function total(from) {
  const first = from & 7;
  let sum = 0;
  let outside = 0;
  for (const word of each()) {
    for (let i = 0; i < word.length; i++) {
      const a = word.charCodeAt(i),
        b = word.charCodeAt(i + 1);
      const at = word.charCodeAt(first);
      if (at === 35) sum += 2;
      if (at !== at) outside++;
      sum += a * 31 + (b | 0);
    }
  }
  return sum + "," + outside;
}
globalThis.kept = total;
for (const from of [0, 1, 2, 3, 7, 8, 9]) console.log(total(from));
