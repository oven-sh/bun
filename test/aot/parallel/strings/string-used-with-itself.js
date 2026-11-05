// One value in both places of an operation on strings: compared with itself, looked for in itself, cut by itself.
function report(name, S) {
    const lines = [
        S <= S, S >= S, S < S, S > S, S === S, S == S, S !== S, S != S, Object.is(S, S),
        S.startsWith(S), S.endsWith(S), S.includes(S), S.indexOf(S), S.lastIndexOf(S), S.search(S), S.localeCompare(S),
        JSON.stringify(S.split(S)), JSON.stringify(S.replace(S, S)), JSON.stringify(S.replaceAll(S, S)), JSON.stringify(S.concat(S)), JSON.stringify(S + S), JSON.stringify(`${S}${S}`),
        S.startsWith(S, 1), S.endsWith(S, 1), S.indexOf(S, 1), S.lastIndexOf(S, 0), JSON.stringify(S.padStart(3, S)), JSON.stringify(S.padEnd(3, S)),
    ];
    console.log(name, lines.join(" "));
}

// A value that nothing else names.
const k1 = "a"; console.log(k1 <= k1);
const k2 = "a"; console.log(k2 >= k2);
const k3 = "a"; console.log(k3 < k3);
const k4 = "a"; console.log(k4 > k4);
const k5 = "a"; console.log(k5 === k5);
const k6 = "a"; console.log(k6 == k6);
const k7 = "a"; console.log(k7 !== k7);
const k8 = "a"; console.log(k8.startsWith(k8));
const k9 = "a"; console.log(k9.endsWith(k9));
const k10 = "a"; console.log(k10.includes(k10));
const k11 = "a"; console.log(k11.indexOf(k11));
const k12 = "a"; console.log(k12.lastIndexOf(k12));
const k13 = "a"; console.log(JSON.stringify(k13.split(k13)));
const k14 = "a"; console.log(k14.replace(k14, k14));
const k15 = "a"; console.log(k15.localeCompare(k15));
const k16 = "a"; console.log(k16 + k16);
const k17 = "a"; console.log(k17.concat(k17));
const k18 = "ab"; console.log(k18 <= k18);
const k19 = "ab"; console.log(k19 >= k19);
const k20 = "ab"; console.log(k20 < k20);
const k21 = "ab"; console.log(k21 > k21);
const k22 = "ab"; console.log(k22 === k22);
const k23 = "ab"; console.log(k23 == k23);
const k24 = "ab"; console.log(k24 !== k24);
const k25 = "ab"; console.log(k25.startsWith(k25));
const k26 = "ab"; console.log(k26.endsWith(k26));
const k27 = "ab"; console.log(k27.includes(k27));
const k28 = "ab"; console.log(k28.indexOf(k28));
const k29 = "ab"; console.log(k29.lastIndexOf(k29));
const k30 = "ab"; console.log(JSON.stringify(k30.split(k30)));
const k31 = "ab"; console.log(k31.replace(k31, k31));
const k32 = "ab"; console.log(k32.localeCompare(k32));
const k33 = "ab"; console.log(k33 + k33);
const k34 = "ab"; console.log(k34.concat(k34));
const k35 = ""; console.log(k35 <= k35);
const k36 = ""; console.log(k36 >= k36);
const k37 = ""; console.log(k37 < k37);
const k38 = ""; console.log(k38 > k38);
const k39 = ""; console.log(k39 === k39);
const k40 = ""; console.log(k40 == k40);
const k41 = ""; console.log(k41 !== k41);
const k42 = ""; console.log(k42.startsWith(k42));
const k43 = ""; console.log(k43.endsWith(k43));
const k44 = ""; console.log(k44.includes(k44));
const k45 = ""; console.log(k45.indexOf(k45));
const k46 = ""; console.log(k46.lastIndexOf(k46));
const k47 = ""; console.log(JSON.stringify(k47.split(k47)));
const k48 = ""; console.log(k48.replace(k48, k48));
const k49 = ""; console.log(k49.localeCompare(k49));
const k50 = ""; console.log(k50 + k50);
const k51 = ""; console.log(k51.concat(k51));
const k52 = "\u03b1"; console.log(k52 <= k52);
const k53 = "\u03b1"; console.log(k53 >= k53);
const k54 = "\u03b1"; console.log(k54 < k54);
const k55 = "\u03b1"; console.log(k55 > k55);
const k56 = "\u03b1"; console.log(k56 === k56);
const k57 = "\u03b1"; console.log(k57 == k57);
const k58 = "\u03b1"; console.log(k58 !== k58);
const k59 = "\u03b1"; console.log(k59.startsWith(k59));
const k60 = "\u03b1"; console.log(k60.endsWith(k60));
const k61 = "\u03b1"; console.log(k61.includes(k61));
const k62 = "\u03b1"; console.log(k62.indexOf(k62));
const k63 = "\u03b1"; console.log(k63.lastIndexOf(k63));
const k64 = "\u03b1"; console.log(JSON.stringify(k64.split(k64)));
const k65 = "\u03b1"; console.log(k65.replace(k65, k65));
const k66 = "\u03b1"; console.log(k66.localeCompare(k66));
const k67 = "\u03b1"; console.log(k67 + k67);
const k68 = "\u03b1"; console.log(k68.concat(k68));
let l0 = "a"; console.log(l0 <= l0);
let l1 = "a"; console.log(l1 >= l1);
let l2 = "a"; console.log(l2 < l2);
let l3 = "a"; console.log(l3 > l3);

const one = "a";
console.log("const one", one <= one, one >= one, one < one, one > one, one === one, one == one, one !== one, one != one);
console.log(one.startsWith(one), one.endsWith(one), one.includes(one), one.indexOf(one), one.lastIndexOf(one), one.localeCompare(one), JSON.stringify(one.split(one)), one.replace(one, one), one.concat(one), one + one);
let other = "b";
console.log("let one", other <= other, other >= other, other < other, other > other, other === other, other.startsWith(other), other.indexOf(other), JSON.stringify(other.split(other)));
const two = "ab";
console.log("const two", two <= two, two >= two, two < two, two > two, two === two, two.startsWith(two), two.endsWith(two), two.includes(two), two.indexOf(two), two.lastIndexOf(two), JSON.stringify(two.split(two)), two.replace(two, two));
const empty = "";
console.log("empty", empty <= empty, empty >= empty, empty < empty, empty > empty, empty === empty, empty.startsWith(empty), empty.endsWith(empty), empty.includes(empty), empty.indexOf(empty), empty.lastIndexOf(empty), JSON.stringify(empty.split(empty)));
const wide = "α";
console.log("two bytes", wide <= wide, wide >= wide, wide < wide, wide > wide, wide === wide, wide.startsWith(wide), wide.indexOf(wide), JSON.stringify(wide.split(wide)));
const pair = "😀";
console.log("a pair", pair <= pair, pair < pair, pair.indexOf(pair), pair.at(0) <= pair.at(0), pair[1] >= pair[1]);

// One character that a computation gives.
const text = "xyz";
const at = text.at(1), charAt = text.charAt(1), index = text[1], cut = text.slice(1, 2), normalized = "y".normalize();
console.log(at <= at, at < at, charAt <= charAt, charAt > charAt, index <= index, index >= index, cut <= cut, cut < cut, normalized <= normalized, normalized > normalized);

if (one <= one) console.log("taken"); else console.log("not taken");
if (one < one) console.log("taken"); else console.log("not taken");
for (let i = 0; i < 3 && one >= one; i++) console.log(i, one > one ? "above" : "not above");

for (const [name, S] of [["a", "a"], ["ab", "ab"], ["empty", ""], ["alpha", "α"], ["pair", "😀"], ["dot", "."], ["dollar", "$&"]]) report(name, S);
