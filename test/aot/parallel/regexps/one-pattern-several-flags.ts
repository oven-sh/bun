// One record of the image is used under several sets of flags, in either order, and from several sites.
const make = [
  () => /a(b)?/,
  () => /a(b)?/g,
  () => /a(b)?/y,
  () => /a(b)?/gy,
  () => /a(b)?/d,
  () => /a(b)?/gd,
  () => /a(b)?/i,
  () => /a(b)?/gi,
  () => /a(b)?/u,
];
function show(re: RegExp) {
  re.lastIndex = 1;
  const match = re.exec("xabAB");
  return [re.source, re.flags, re.lastIndex, match && match.index, match && match[1], match && "indices" in match].join(" ");
}
for (const order of [[0, 1, 2, 3, 4, 5, 6, 7, 8], [8, 7, 6, 5, 4, 3, 2, 1, 0], [3, 0, 3, 1, 1, 5, 5, 0]])
  for (const i of order) console.log(i, show(make[i]!()));
const seen = new Set<RegExp>();
for (let turn = 0; turn < 3; turn++)
  for (const one of make) {
    const re = one();
    console.log(seen.has(re), re.lastIndex);
    re.lastIndex = turn + 1;
    seen.add(re);
  }
console.log(seen.size, "aab-ab".replace(/a(b)?/g, "<$1>"), "aab-ab".replace(/a(b)?/, "<$1>"), "aab".split(/a(b)?/).length, [..."abab".matchAll(/a(b)?/g)].length);
