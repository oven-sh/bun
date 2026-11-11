// Under: --aot-check=Validate: a sum that is a number or not a number is compared with a shift
function settle(shift, value) {
  let kept = 0;
  for (let turn = 0; turn < 4; turn++) { if ((+kept) !== (value >> shift)) { kept = value; } }
  return kept;
}
const pairs = JSON.parse("[[0,0],[1,2],[0,0.5],[33,5],[2,7]]");
for (const p of pairs) console.log(settle(p[0], p[1]));
