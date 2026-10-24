// `new Array(n).fill(v)` in one expression is how programs write a table of flags or of small counts.
function flags(mask: number): number {
  const seen = new Array(64).fill(false);
  for (let i = 0; i < 64; i++) {
    if ((i & mask) === 0) seen[i] = true;
  }
  let count = 0;
  for (let i = 0; i < 64; i++) {
    if (seen[i]) count++;
  }
  return count;
}

function flagsWithoutNew(mask: number): number {
  const seen = Array(64).fill(true);
  for (let i = 0; i < 64; i++) {
    if ((i & mask) === 0) seen[i] = false;
  }
  let count = 0;
  for (let i = 0; i < 64; i++) {
    if (seen[i]) count++;
  }
  return count;
}

let total = 0;
for (let k = 0; k < 20000; k++) total = (total + flags(k & 7) * 100 + flagsWithoutNew(k & 7)) | 0;
console.log(total);
