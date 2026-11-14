// Counts that a test alone decides, in loops: one is added or not, without a branch. Tests of numbers, texts, kinds, holes, NaN; counts up and down, two at a time, in nests, near where doubles round.
// STATISTIC: CountsUnderTestsFolded >= 10
function above(list, k) { let n = 0; for (let i = 0; i < list.length; i++) if (list[i] > k) n++; return n; }
function both(list, k) { let a = 0, b = 0; for (const x of list) if (x > k) a++; else b++; return a * 1000 + b; }
function down(list) { let n = 5; for (let i = 0; i < list.length; i++) if (list[i] & 1) n--; return n; }
function either(list) { let n = 0; for (let i = 0; i < list.length; i++) if (list[i] < 3) n++; else n--; return n; }
function pairs(list) { let n = 0; for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (list[i] > list[j]) n++; return n; }
function range(list, a, b) { let n = 0; for (let i = 0; i < list.length; i++) if (list[i] >= a && list[i] < b) n++; return n; }
function letters(text) { let n = 0, m = 0; for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c === 101) n++; if (c < 97) m++; } return [n, m]; }
function bits(view) { let n = 0; for (let i = 0; i < view.length; i++) if (!(view[i] & 4)) n++; return n; }
function texts(list) { let n = 0; for (const x of list) if (x === "b") n++; return n; }
function kinds(list) { let n = 0, s = 0; for (const x of list) { if (typeof x === "string") s++; if (x) n++; } return [n, s]; }
function from(list, n) { for (let i = 0; i < list.length; i++) if (list[i] > 1) n++; return n; }
function beside(list) { let n = 0, sum = 0; for (let i = 0; i < list.length; i++) { if (list[i] > 2) n++; sum += n; } return [n, sum]; }
function ends(list) { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] > 2) n++; if (n > 5) break; } return n; }
function twice(list) { let n = 0; for (let i = 0; i < list.length; i++) if (list[i] > 2) { n++; n++; } return n; }
function words(list) { let n = 0; for (let i = 0; i < list.length; i++) { let x = list[i] | 0; if (x > 100) x = x - 1; n += x; } return n; }
function* told(list) { let n = 0; for (const x of list) { if (x > 2) n++; if (x === 4) yield n; } return n; }
const ints = Array.from({ length: 60 }, (_, i) => i * 7919 % 13), lists = [ints, ints.map(x => x / 2), ints.map((x, i) => i % 7 ? x : "s" + x), [1, , 3, , 5], [NaN, -0, Infinity, 2147483648, 3], [], ["a", "b", "b", null, undefined, {}, 4n], new Float64Array(ints), new Uint8Array(ints)];
const show = value => Array.isArray(value) ? "[" + value.map(show) + "]" : Object.is(value, -0) ? "-0" : String(value);
const attempt = run => { try { return show(run()); } catch (error) { return error.name; } };
for (let turn = 0; turn < 2; turn++) for (const list of lists) console.log([() => above(list, 4), () => both(list, 4), () => down(list), () => either(list), () => pairs(list), () => range(list, 2, 7), () => bits(list), () => texts(list), () => kinds(list), () => from(list, 2 ** 53 - 2), () => from(list, 0.5), () => from(list, "x"), () => from(list, -3), () => beside(list), () => ends(list), () => twice(list), () => words(list), () => [...told(list)]].map(attempt).join(" "));
console.log(show(letters("The quick brown fox jumps over the lazy dog")), show(letters("")));
