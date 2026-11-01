// A NaN that was computed and the constant NaN are one value wherever values are compared.
const zero = [0].map(Number)[0];
function typed(nothing: number, constant: number) {
  const computed = nothing / nothing,
    negated = -constant;
  const byNumber = new Map<number, string>([[constant, "constant"]]);
  const numbers = new Set<number>([constant, computed, negated]);
  console.log("typed map", byNumber.has(computed), byNumber.get(computed), byNumber.get(negated), byNumber.size);
  byNumber.set(computed, "computed");
  byNumber.set(negated, "negated");
  console.log(
    "typed map after set",
    byNumber.size,
    byNumber.get(constant),
    numbers.size,
    numbers.has(computed),
    numbers.delete(negated),
    numbers.size,
  );
  console.log(
    "Object.is",
    Object.is(computed, constant),
    Object.is(negated, computed),
    Object.is(computed, computed),
    Object.is(computed, 0),
  );
  console.log(
    "includes",
    [constant].includes(computed),
    [computed].includes(constant),
    [1.5, computed].includes(negated),
    [1, 2, computed].indexOf(computed),
    ["x", computed].includes(constant),
  );
  console.log(
    "views",
    new Float64Array([computed]).includes(constant),
    new Float32Array([constant]).includes(computed),
    new Float64Array([computed]).indexOf(computed),
  );
  console.log(
    "equality",
    computed === computed,
    computed == constant,
    computed !== constant,
    computed < 1,
    computed >= 1,
  );
  console.log(
    "text",
    String(computed),
    `${negated}`,
    computed + "",
    computed.toFixed(2),
    JSON.stringify([computed, negated, { x: computed }]),
    computed.toString(2),
  );
  switch (computed) {
    case constant:
      console.log("switch took NaN");
      break;
    default:
      console.log("switch took the default");
  }
  const keyed: Record<string, number> = {};
  keyed[computed] = 1;
  keyed[negated] = 2;
  keyed[constant] = 3;
  console.log("keys", Object.keys(keyed), keyed.NaN);
  console.log(
    "sort",
    [3, computed, 1, negated, 2].sort(),
    [3, computed, 1].sort((a, b) => a - b).length,
    Math.max(1, computed),
    Math.min(negated, 1),
    Math.round(computed),
    computed | 0,
    ~~negated,
    computed >>> 0,
  );
  console.log(
    "grouped",
    [...Map.groupBy([computed, constant, negated, 1], value => value).keys()].length,
    Object.keys(Object.groupBy([computed, constant], value => value)),
  );
  console.log(
    "truth",
    !computed,
    computed ? 1 : 2,
    computed || "or",
    computed ?? "nullish",
    Number.isNaN(computed),
    isNaN(negated),
    Number.isFinite(computed),
    Number.isInteger(negated),
  );
}
typed(zero, NaN);
function untyped(nothing: any, constant: any) {
  const computed = nothing / nothing,
    negated = -constant;
  const map = new Map();
  map.set(constant, "constant");
  console.log("map", map.has(computed), map.get(computed), map.get(negated));
  map.set(computed, "computed");
  map.set("x", 1);
  console.log(
    "map after set",
    map.size,
    map.get(constant),
    new Set([constant, computed, negated, "x"]).size,
    map.delete(negated),
    map.size,
  );
  console.log(
    "Object.is",
    Object.is(computed, constant),
    Object.is(negated, computed),
    [constant, "x"].includes(computed),
    [computed, {}].includes(negated),
  );
}
untyped(zero, NaN);
for (let i = 0; i < 3; i++) {
  const seen = new Set<number>();
  for (let j = 0; j < 4; j++) seen.add((j - j) / (i - i));
  console.log("in a loop", seen.size);
}
