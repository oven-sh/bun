const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const show = (map) => JSON.stringify([...map].map(([key, value]) => [Object.is(key, -0) ? "-0" : key, Object.is(value, -0) ? "-0" : value]));
const whole = (n) => { const all = []; for (let i = 0; i < n; i++) all.push([i | 0, (i * 3) | 0]); return all; };
const fractions = (n) => { const all = []; for (let i = 0; i < n; i++) all.push([i + 0.5, i * 0.25]); return all; };
const wholeInDoubles = (n) => { const all = []; for (let i = 0; i < n; i++) all.push([i * 0.5 * 2, i * 1.5]); return all; };
const signed = (n) => { const all = []; for (let i = 0; i < n; i++) all.push([i * -0.5 * (i & 1), i * -0.0]); return all; };
const longer = (n) => { const all = []; for (let i = 0; i < n; i++) all.push([i + 0.5, i * 0.25, i * 0.125]); return all; };
const mixedKinds = (n) => { const all = []; for (let i = 0; i < n; i++) all.push(i % 3 === 0 ? [i | 0, 1] : i % 3 === 1 ? [i + 0.5, 2.5] : ["k" + i, i]); return all; };
for (const make of [whole, fractions, wholeInDoubles, signed, longer, mixedKinds]) {
    const map = new Map(unseen(make)(7));
    console.log(map.size, show(map), map.get(2), map.get(2.5), map.has(0), map.has(-0), map.get(1));
}
const short = unseen(fractions)(3); short[1].length = 1;
try { console.log(show(new Map(short))); } catch (error) { console.log(error.constructor.name); }
const holed = unseen(fractions)(3); delete holed[1][0];
console.log(show(new Map(holed)), new Map(holed).has(undefined));
const nan = unseen(fractions)(3); nan[1][0] = NaN; nan[2][1] = NaN;
console.log(new Map(nan).has(NaN), Number.isNaN(new Map(nan).get(2.5)), new Map(nan).size);
const named = unseen(fractions)(3); named[1].extra = 1;
console.log(show(new Map(named)));
const below = unseen(whole)(3); Object.setPrototypeOf(below[1], { __proto__: Array.prototype });
console.log(show(new Map(below)));
const written = new Map([[1, 2], [3.5, 4.5], [5, 6.5]]);
console.log(show(written), written.get(5));
let all = 0; for (let t = 0; t < 40; t++) all += new Map(fractions(8)).size + new Map(whole(8)).get(t & 7);
console.log(all);
