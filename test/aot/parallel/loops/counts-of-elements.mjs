// Loops outside of any nest that count the elements of strings, views and arrays which pass a test: several iterations are laid out at a time, and the loop as written takes what is left over.
// STATISTIC: UnrolledLoopsEmitted >= 40
const commas = text => { let n = 0; for (let i = 0; i < text.length; i++) if (text[i] === ",") n++; return n; };
const spaces = text => { let n = 0; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) !== 32) n++; return n; };
const wide = text => { let n = 0; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 255) n++; return n; };
const bytes = view => { let n = 0; for (let i = 0; i < view.length; i++) if (view[i] === 10) n++; return n; };
const clear = view => { let n = 9; for (let i = 0; i < view.length; i++) if (!(view[i] & 4)) n--; return n; };
const above = list => { let n = 0; for (let i = 0; i < list.length; i++) if (list[i] > 4) n++; return n; };
const odd = list => { let n = 0; for (let i = 0; i < list.length; i++) if (list[i] & 1) n++; return n; };
const same = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] === b[i]) n++; return n; };
const sides = list => { let n = 0, m = 0; for (let i = 0; i < list.length; i++) { if (list[i] < 3) n++; if (list[i] >= 7) m++; } return n * 1000 + m; };
const from = (list, n) => { for (let i = 0; i < list.length; i++) if (list[i] > 1) n++; return n; };
const each = list => { let n = 0; for (const x of list) if (x > 2) n++; return n; };
const until = (list, end) => { let n = 0; for (let i = 0; i < end; i++) if (list[i] === 3) n++; return n; };
const show = value => Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : String(value);
const attempt = run => { try { return show(run()); } catch (error) { return error.name; } };
const filler = JSON.parse('["a, b\\n", "Ω, 3\\n", ""]');
const texts = [], lists = [], views = [];
for (let length = 0; length < 20; length++) {
  for (const unit of filler) texts.push(unit.repeat(length).slice(0, length * 2));
  texts.push(texts[length] + texts[length + 1]);
  const ints = Array.from({ length }, (_, i) => i * 7919 % 13);
  lists.push(ints, ints.map(x => x / 2), ints.map((x, i) => i % 5 ? x : String(x)), ints.map((x, i) => i % 6 ? x : undefined));
  if (length > 3) { const holes = ints.slice(); delete holes[2]; lists.push(holes, ints.map((x, i) => i === 3 ? NaN : i === 2 ? -0 : 2147483648 + x)); }
  views.push(Uint8Array.from(ints), Int8Array.from(ints), Uint32Array.from(ints, x => x * 400000000), Float64Array.from(ints, x => x - 0.5), Float32Array.from(ints));
}
let sum = 0, number = 0;
const note = line => { for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0; if (number++ % 11 === 0) console.log(line); };
for (const text of texts) note([commas, spaces, wide].map(run => attempt(() => run(text))).join(" "));
for (const list of [...lists, ...views]) note([() => above(list), () => odd(list), () => sides(list), () => same(list, list), () => same(list, lists[40]), () => bytes(list), () => clear(list), () => each(list), () => until(list, list.length + 3), () => until(list, 2), () => from(list, 2 ** 53 - 2), () => from(list, 2147483640), () => from(list, 0.5), () => from(list, "x"), () => from(list, 3n)].map(attempt).join(" "));
const strange = [{ length: 3, 0: 5, 2: 7 }, new Proxy([1, 5, 9], {}), Object.defineProperty([1, 2, 3], 1, { get() { return 8; } }), null, undefined, 7, [1n, 5n], [{ valueOf() { sum += 1; return 9; } }, 3], Object.freeze([1, 9, 9, 9, 9, 9, 9, 9, 9]), new Array(12)];
for (const list of strange) note([() => above(list), () => odd(list), () => sides(list), () => same(list, list), () => each(list), () => until(list, 4), () => commas(list)].map(attempt).join(" "));
console.log(number, sum);
