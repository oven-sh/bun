// A literal holds the value of a for-of loop, nothing reads the value behind the literal, and the loop right behind it pushes onto the literal: the build stopped.
function integers(xs) {
  for (const x of xs) {
    const l = [x];
    for (let k = 0; k < 3; k++) l.push({ k });
  }
}
integers([1, 2, 3]);
function numbers(xs) {
  for (const x of xs) {
    const l = [x];
    for (let k = 0; k < 3; k++) l.push({ k });
  }
}
numbers([NaN, 5, -0, Infinity]);
function lengths(xs) {
  let n = 0;
  for (const x of xs) {
    const l = [x];
    for (let k = 0; k < 3; k++) l.push({ k });
    n += l.length;
  }
  return n;
}
console.log(lengths([1.5, 2.5]));
function texts(xs) {
  for (const x of xs) {
    const l = [x];
    for (let k = 0; k < 3; k++) l.push("a");
  }
}
texts([1.5, NaN]);

const show = value => Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + value.map(show).join(" ") + "]" : value && typeof value === "object" ? JSON.stringify(value) : String(value);
function kept(xs) {
  const all = [];
  for (const x of xs) {
    const row = [x];
    for (let k = 0; k < 3; k++) row.push({ k });
    all.push(row);
  }
  return all;
}
console.log(show(kept([NaN, 5, -0, Infinity])));
function keptTexts(xs) {
  const all = [];
  for (const x of xs) {
    const row = [x];
    for (let k = 0; k < 3; k++) row.push("b" + k);
    all.push(row);
  }
  return all;
}
console.log(show(keptTexts(["a", "", "c"])));
function keptMixed(xs, turns) {
  const all = [];
  for (const x of xs) {
    const row = [x];
    for (let k = 0; k < turns; k++) row.push(k * 0.5);
    all.push(row);
  }
  return all;
}
const turns = Number(globalThis.missing ?? 4);
console.log(show(keptMixed([1, "a", null, undefined, true, NaN, , 7n], turns)));
console.log(show(keptMixed([2 ** 40, -1], turns - 4)));
function pairs(xs, turns) {
  const all = [];
  let i = 0.5;
  for (const x of xs) {
    const row = [i, x];
    for (let k = 0; k < turns; k++) row.push("p");
    i += 1;
    all.push(row);
  }
  return all;
}
console.log(show(pairs([NaN, 3], turns)));
function nested(xs) {
  const all = [];
  for (const x of xs) {
    const row = [[x], { x }, () => x];
    for (let k = 0; k < 3; k++) row.push({ k });
    row[0].push(row[2]());
    all.push(row.slice(0, 2).concat(row.length));
  }
  return all;
}
console.log(show(nested([1, -0, "n"])));
function destructured(entries) {
  const all = [];
  for (const [name, value] of entries) {
    const row = [value, name];
    for (let k = 0; k < 3; k++) row.push({ k });
    all.push(row);
  }
  return all;
}
console.log(show(destructured([["one", 1], ["two", NaN]])));
