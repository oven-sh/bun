// A hole behind a spread in an array literal is a hole: it is read as undefined under an index, by iteration and by destructuring, in loops and outside them.
const more = [1, 2], strings = ["a"], doubles = [0.5, 1.5], objects = [{ k: 1 }], none = [];
const list = [...more, , "b"];
console.log(list.length, typeof list[2], list[2], list[2] === undefined, 2 in list, list[3], list[4]);
for (const k of [...more, , "b"]) console.log(typeof k, k === undefined, String(k));
for (const k of [0, ...more, , 5]) console.log(String(k), k + 1);
for (const k of ["z", ...strings, , "b"]) { const o = {}; o[k] = 1; console.log(Object.keys(o).join()); }
for (const k of [...doubles, , 2.5]) console.log(typeof k, k * 2, k ?? "none");
for (const k of [...objects, , { k: 2 }]) console.log(typeof k, k && k.k, k?.k);
for (const k of [, ...more, , ...more, ,]) console.log(k);
for (const k of [...none, ,]) console.log(k);
for (const k of [...none, , 1]) console.log(k);
const [p, q, r, s = "default", t] = [...more, , , 5];
console.log(p, q, r, s, t);
const [u, ...rest] = [...strings, , 7, ,];
console.log(u, rest.length, 0 in rest, rest[0], rest.map(String).join());
function made(given, x) { return [...given, , x]; }
function twice(given) { return [...given, , ...given, , ,]; }
function sum(l) { let n = 0; for (let i = 0; i < l.length; i++) { const v = l[i]; n += v === undefined ? 100 : v; } return n; }
function kinds(l) { let text = ""; for (let i = 0; i < l.length; i++) text += typeof l[i] + (i in l ? "!" : "?") + " "; return text; }
function total(l) { let n = 0; for (const v of l) n += v; return n; }
function keys(l) { const o = {}; for (let i = 0; i < l.length; i++) o[l[i]] = i; return JSON.stringify(o); }
for (let turn = 0; turn < 3; turn++) {
    for (const given of [[1, 2], [0.5], ["a"], [], [{}], new Set([1, 2]), "xy", [1, , 2], Array.from({ length: 30 }, (_, i) => i)]) {
        const l = made(given, turn), m = twice(given);
        console.log(l.length, kinds(l), sum(l), total(l), keys(l), m.length, sum(m), kinds(m));
        console.log(JSON.stringify(l), l.indexOf(undefined), l.includes(undefined), l.join(), l.map(x => typeof x).join(), l.filter(() => true).length, l.reduce((n, x) => n + 1, 0), Object.keys(l).join());
        console.log(kinds(l.concat([, 3])), kinds(l.slice(0, -1)), kinds([...l, ,]), kinds(l.reverse()), kinds(l.flat()), l.some(x => x === undefined), l.findIndex(x => x === undefined), l.at(-2));
        l.length += 2; console.log(kinds(l), sum(l)); delete l[0]; console.log(kinds(l), l[0]); l[l.length + 3] = 9; console.log(kinds(l), total([...l]));
        l.sort(); console.log(kinds(l)); l.fill(1); console.log(kinds(l)); l.splice(1, 1, ...[, 2]); console.log(kinds(l));
    }
}
function* steps() { const l = [...more, , yield 1, , yield 2]; for (const v of l) yield typeof v; return l[2]; }
const g = steps(); console.log(JSON.stringify([g.next(), g.next("x"), g.next("y"), ...g]));
(async () => { const l = [...more, , await 3, ,]; for (const v of l) console.log(typeof v); console.log(l[2], l[4], l.length); })();
const n = Array(3); n[1] = 5; console.log(kinds(n), n[0], sum([...n, , 1]));
function filled(count) { const l = [...more, ,]; for (let i = 0; i < count; i++) l.push(i * 0.5); let a = 0; for (let i = 0; i < l.length; i++) a += l[i] ?? 1000; return a; }
console.log(filled(0), filled(3), filled(40));
function stored(count) { const l = [...doubles, , 0.25]; for (let i = 0; i < count; i++) l[i] = i + 0.5; let a = ""; for (let i = 0; i < l.length; i++) a += l[i] + " "; return a; }
console.log(stored(0), stored(2), stored(3), stored(6));
const holder = { list: [...strings, , "c"] };
for (let i = 0; i < 5; i++) { const v = holder.list[i % 4]; console.log(v === undefined ? "nothing" : v.length); }
console.log(Math.max(...[...more, ,]), String.fromCharCode(...[...more.map(x => x + 64), , 66]).length, ((...a) => a.length + typeof a[2])(...[...more, , 1]), new Array(...[...more, , 4]).length);
switch ([...more, , 1][2]) { case undefined: console.log("undefined"); break; default: console.log("other"); }
