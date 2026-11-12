function firstOver(stock, limit) {
  for (const [name, count] of Object.entries(stock)) {
    if (count < 0) continue;
    if (count > limit) return name + ":" + count;
  }
  return "none";
}
function cross(stock) {
  const seen = [];
  outer: for (const [a, x] of Object.entries(stock)) {
    for (const [b, y] of Object.entries(stock)) {
      if (b === "plums") continue outer;
      if (x + y > 3) break outer;
      seen.push(a + b);
    }
  }
  return seen.join(",");
}
function guarded(stock) {
  const marks = [];
  try {
    for (const [name, count] of Object.entries(stock)) {
      try { if (count === 2) throw new RangeError(name); marks.push(name); } finally { marks.push("f" + count); }
    }
  } catch (error) { marks.push(error.name + ":" + error.message); }
  return marks.join(",");
}
function gaps(stock) {
  const seen = [];
  for (const [, count = 7] of Object.entries(stock)) seen.push(count);
  return seen.join(",");
}
let out = "";
for (let round = 0; round < 300; round++)
  out = [firstOver({ apples: 1, pears: -2, plums: 3 }, 1 + (round & 1)), cross({ apples: 1, pears: 2, plums: 3 }), guarded({ apples: 1, pears: 2, plums: 3 }), gaps({ left: undefined, right: round })].join(" | ");
console.log(out);
