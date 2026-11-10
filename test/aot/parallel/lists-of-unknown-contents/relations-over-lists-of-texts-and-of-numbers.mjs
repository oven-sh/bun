// A sum, a relation and a store in the turn over lists of which nothing is known: numbers, texts, both, holes, views, proxies, arguments.
function sum(d, n) { let s = 0; for (let i = 0; i < n; i++) s += d[i]; return s; }
function below(names, pivot) { let c = 0; for (let i = 0; i < names.length; i++) if (names[i] < pivot) c++; return c; }
function belowG(names) { let c = 0; for (let i = 0; i < names.length; i++) if (names[i] < "g") c++; return c; }
function belowTen(list) { let c = 0; for (let i = 0; i < list.length; i++) if (list[i] < 10) c++; return c; }
function turns(d) { let s = 0; for (let i = 0; i < d.length; i++) { s += d[i] * 2; if (i === 0) d[1] = "4"; } return s; }
const J = JSON.parse('[[1.5,2.5],[1,2],["a","b"],[1,"b",2.5],["pear","apple","fig","kiwi"]]');
for (let round = 0; round < 3; round++) {
    console.log(sum(J[0].slice(), 2), sum(J[1].slice(), 3), sum([1.5, , 2.5], 3), sum(J[2].slice(), 2), sum(J[3].slice(), 3), sum(undefined, 0));
    console.log(sum(Float64Array.of(1.5, 2), 2), sum(new Proxy(J[0], {}), 2), (function () { return sum(arguments, 2); })(1.5, 2), turns(J[0].concat([3.5])));
    console.log(below(J[4].slice(), "g"), below(J[1].slice(), 2), below(J[3].slice(), 2), below(J[3].slice(), "c"), below([], 1), below(["10", 9, "8"], "a"));
    console.log(belowG(J[4].slice()), belowG(J[1].slice()), belowG(J[3].slice()), belowTen(J[4].slice()), belowTen([1, 50, 9.5]), belowTen(["9", 90]), belowTen([NaN, undefined]));
}
