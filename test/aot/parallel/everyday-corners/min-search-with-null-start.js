// Min search with null start: compiled answers as plain.
function least(list) {
  let best = null;
  for (const v of list) if (best === null || v < best) best = v;
  return best;
}
for (const l of [[3, 1, 2], [], ["b", "a"], [0, -0], [NaN, 1], [1, NaN]])
  console.log(Object.is(least(l), -0) ? "-0" : String(least(l)));
