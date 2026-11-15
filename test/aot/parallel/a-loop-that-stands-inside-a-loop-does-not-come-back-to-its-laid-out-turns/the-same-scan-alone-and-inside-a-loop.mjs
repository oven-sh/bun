// STATISTIC: UnrolledLoopsWithReentry = 1
const rounds = Number(process.argv[2] ?? 3);
const bytes = Uint8Array.from(new TextEncoder().encode('"one" "two\\"x" 12 "three and a longer text that goes on for a while \\\\ and on" "four" "" "\\"" 7'));
function alone(d, from) {
  let at = from, hash = 0;
  while (at < d.length) {
    if (d[at] === 92) at++;
    hash = (Math.imul(hash, 31) + d[at]) | 0;
    at++;
  }
  return hash;
}
function inside(d, from) {
  let at = from, hash = 0, texts = 0;
  while (at < d.length) {
    if (d[at] === 34) {
      at++;
      while (at < d.length && d[at] !== 34) {
        if (d[at] === 92) at++;
        hash = (Math.imul(hash, 31) + d[at]) | 0;
        at++;
      }
      texts++;
    }
    at++;
  }
  return (hash + texts * 7) | 0;
}
const byName = { alone, inside };
const said = [];
for (const name of JSON.parse('["alone", "inside"]')) {
  let all = 0;
  for (let round = 0; round < rounds; round++) all = (Math.imul(all, 31) + byName[name](bytes, 0)) | 0;
  said.push(name + " " + all);
}
console.log(said.join(" | "));
