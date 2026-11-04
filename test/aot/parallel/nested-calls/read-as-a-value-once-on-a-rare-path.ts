const kept: Array<(x: number) => number> = [];
function outer(a: number, rare: boolean) {
  let n = a;
  if (rare) kept.push(bump);
  return bump(1) + bump(2);
  function bump(x: number): number { n += x; return n; }
}
console.log(outer(1, false), outer(2, true), outer(3, false), outer(4, true));
console.log(kept.length, kept[0] === kept[1], kept[0](10), kept[0](10), kept[1](10));
