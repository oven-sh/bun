const re = /a/g;
let wrong = 0, kept = 0;
for (let i = 0; i < 200000; i++) {
  re.lastIndex = { i };
  if (i % 500) continue;
  const junk = [];
  for (let k = 0; k < 2000; k++) junk.push({ k });
  kept += junk.length;
  if (re.lastIndex.i !== i) wrong++;
}
console.log(re.lastIndex.i, wrong, kept);
