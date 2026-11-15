// Lists searched (includes, indexOf, lastIndexOf) for elements of other lists: int32s, doubles, -0, NaN, holes, undefined, null, texts; lists that are filled while they are searched, that change kind, that are long; starts.
function f0(l, m) { const out = new Array(3); let n = 0, i = -1; for (const x of l) { i++; if (!(out.indexOf(x, 2) > 0)) { n++; } if (i === 3) delete out[0]; } return [n, out.length, out.map(show).join(" ")].join("|"); }
function f1(l, m) { const out = m.slice(); let n = 0, i = -1; for (const x of l) { i++; if ((out.includes(x | 0))) { out.push(x); } if (i === 4) out.length = 0; } return [n, out.length, out.map(show).join(" ")].join("|"); }
function f2(l, m) { const out = [, 1]; let n = 0, i = -1; for (const x of l) { i++; if ((out.indexOf(l[i - 1]) < 0)) { out.unshift(x); }  } return [n, out.length, out.map(show).join(" ")].join("|"); }
function f3(l, m) { const out = []; let n = 0, i = -1; for (const x of l) { i++; if (!(out.indexOf(x) !== -1)) { out[out.length] = x; } if (i === 3) delete out[0]; } return [n, out.length, out.map(show).join(" ")].join("|"); }
function f4(l, m) { const out = []; let n = 0, i = -1; l.forEach((x, k) => { i = k; if (!(out.includes(l[i + 1]))) { out.push(x); } n += out.indexOf(x); }); return [n, out.length, out.map(show).join(" ")].join("|"); }
function f5(l, m) { const out = [1, 2]; let n = 0, i = -1; for (const x of l) { i++; if (!(out.lastIndexOf(x) > 0)) { out.push(x); } if (i === 3) out.length = 1; } return [n, out.length, out.map(show).join(" ")].join("|"); }
function f6(l, m) { const out = m.slice(); let n = 0, i = -1; for (const x of l) { i++; if ((out.lastIndexOf(x) > 0)) { n++; }  } return [n, out.length, out.map(show).join(" ")].join("|"); }
const show = v => { try { return Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v); } catch { return typeof v; } };
const lists = [() => [2147483648, 1, 2147483648], () => ["a", "b", "a"], () => new Array(5), () => Object.freeze([3, 3, 1]), () => [1, , 2, , 1], () => [1.5, 2, NaN, 2.5, NaN, 0], () => [], () => [0, -0, 1, -1, 2147483647, -2147483648], () => [undefined, null, 1, "1", undefined], () => JSON.parse("[5,5,7,1e3,7]"), () => [1, 2, 2, 3, 1, 4], () => Array.from({ length: 100 }, (_, i) => i % 40), () => Array.from({ length: 90 }, (_, i) => i * 0.5), () => [true, 1, false, 0], () => [4n, 4, 4n]];
const own = [0.5, 2, 3];
for (let round = 0; round < 10; round++) for (const f of [f0, f1, f2, f3, f4, f5, f6]) lists.forEach((make, j) => {
    let answer; try { answer = f(make(), round & 1 ? own : lists[(j + 3) % lists.length]()); } catch (e) { answer = e.name; }
    if (round < 2 || round > 7) console.log(f.name, round, j, answer.length > 300 ? answer.length + answer.slice(0, 200) : answer);
});
let seen = 0; for (let k = 0; k < 300; k++) seen += f0([k % 7, 1, 2, k % 5], own).length; console.log(seen);
