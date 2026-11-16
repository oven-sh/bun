// The elements that are held against one another are objects whose valueOf, toString or Symbol.toPrimitive pushes onto the lists that are read, cuts them, stores texts into them, pushes onto the list that is filled, throws.
const said = [];
function merged(left, right) {
  const out = [];
  let a = 0, b = 0;
  while (a < left.length && b < right.length) out.push(left[a] <= right[b] ? left[a++] : right[b++]);
  return out.length + ":" + out.map(value => typeof value === "object" ? "o" + Number(value.n) : String(value)).join() + "/" + left.length + "/" + right.length;
}
const table = { merged };
const call = (left, right) => { try { return table[JSON.parse('"merged"')](left, right); } catch (error) { return error.constructor.name + ":" + error.message; } };
function spoiler(n, deed) { let done = false; return { n, valueOf() { if (!done) { done = true; deed(); } return n; } }; }
for (let turn = 0; turn < 3; turn++) {
  said.push(call([1, 4, 7, 10], [2, 3, 8, 9]));
  { const left = [1, 4, 7, 10], right = [2, 3, 8, 9]; left[1] = spoiler(4, () => left.push(11, 12)); said.push(call(left, right)); }
  { const left = [1, 4, 7, 10], right = [2, 3, 8, 9]; left[1] = spoiler(4, () => { right.length = 2; }); said.push(call(left, right)); }
  { const left = [1, 4, 7, 10], right = [2, 3, 8, 9]; right[1] = spoiler(3, () => { left[2] = "text"; left[3] = 0.5; }); said.push(call(left, right)); }
  { const left = [1, 4, 7, 10], right = [2, 3, 8, 9]; right[2] = spoiler(8, () => { delete left[3]; }); said.push(call(left, right)); }
  { const left = [1, 4, 7, 10], right = [2, 3, 8, 9]; left[2] = spoiler(7, () => { throw new RangeError("seven"); }); said.push(call(left, right)); }
  { const left = [1, 4, 7, 10], right = [2, 3, 8, 9]; left[2] = { n: 7, [Symbol.toPrimitive]() { right.unshift(0); return 7; } }; said.push(call(left, right)); }
  { const left = [1, 4, 7, 10], right = [2, 3, 8, 9]; Object.defineProperty(right, 1, { get() { left.push(99); return 3; } }); said.push(call(left, right)); }
}
console.log(said.join(" | "));
