let kept = [];
function maker(fail) {
  let count = 1;
  kept.push(function () { return ++count; });
  const box = { n: 10 };
  kept.push(function () { return box.n++; });
  if (fail) throw new Error("midway");
  let never = 5;
  kept.push(function () { return never; });
}
try { maker(true); } catch (error) { console.log(error.message); }
console.log(kept.length, kept[0](), kept[0](), kept[1](), kept[1]());
