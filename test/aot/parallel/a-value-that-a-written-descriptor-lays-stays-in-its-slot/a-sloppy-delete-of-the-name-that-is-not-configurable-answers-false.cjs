function remove(holder) { return delete holder.mark; }
const fixed = {}; Object.defineProperty(fixed, "mark", { value: 11, enumerable: true });
const loose = {}; Object.defineProperty(loose, "mark", { value: 12, enumerable: true, configurable: true });
function read(holder) { let sum = 0; for (let i = 0; i < 40; i++) sum = (sum + (holder.mark ?? -1)) | 0; return sum; }
let said = "";
for (let turn = 0; turn < 300; turn++) {
  if (turn === 150) said += remove(fixed) + " " + remove(loose) + " " + remove(loose) + " ";
  if (turn === 100 || turn === 200) said += read(fixed) + " " + read(loose) + " ";
  read(fixed); read(loose);
}
console.log(said, "mark" in fixed, "mark" in loose);
