// A record has limits: masks of 32 bits for parameters and results, 64 subjects a function, eight keys a list, paths of four reads. Whatever lies past a limit must count as "anything", never as "nothing": here the one thing that matters always lies just past it.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
const o = tag => ({ tag, held: null });

// Forty parameters. Parameter 35 is stored into parameter 33; parameter 36 is returned; parameter 38 is kept; parameter 3 (35 - 32) and its like are left alone.
function forty(p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27, p28, p29, p30, p31, p32, p33, p34, p35, p36, p37, p38, p39) {
  p33.held = p35;
  if (p38.tag.endsWith("9")) kept.push(p38);
  return p36;
}
function callForty(i) {
  const into = o("into" + i);
  const back = o("back" + i);
  const answer = forty(o("0"), o("1"), o("2"), o("3"), o("4"), o("5"), o("6"), o("7"), o("8"), o("9"), o("10"), o("11"), o("12"), o("13"), o("14"), o("15"), o("16"), o("17"), o("18"), o("19"), o("20"), o("21"), o("22"), o("23"), o("24"), o("25"), o("26"), o("27"), o("28"), o("29"), o("30"), o("31"), o("32"), into, o("34"), o("stored" + i), back, o("37"), o("kept" + i), o("39"));
  churn(2);
  return into.held.tag + " " + (answer === back);
}
let line = "";
for (let i = 0; i < 120; i++) line = callForty(i);
console.log(line, churn(60), kept.map(k => k.tag).join());
kept.length = 0;

// Exactly at the edges: parameters 31, 32 and 63, 64.
function edges(...all) {
  return edgesFixed.apply(null, all);
}
function edgesFixed(a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24, a25, a26, a27, a28, a29, a30, a31, a32, a33, a34, a35, a36, a37, a38, a39, a40, a41, a42, a43, a44, a45, a46, a47, a48, a49, a50, a51, a52, a53, a54, a55, a56, a57, a58, a59, a60, a61, a62, a63, a64, a65) {
  kept.push(a31, a32, a63, a64);
  a0.held = a64;
  a64.held = a1;
  return a65;
}
for (let i = 0; i < 3; i++) {
  const all = [];
  for (let j = 0; j < 66; j++) all.push(o(i + "." + j));
  const answer = edges(...all);
  console.log(answer === all[65], all[0].held === all[64], all[64].held === all[1]);
}
console.log(churn(40), kept.map(k => k.tag).join());
kept.length = 0;

// Seventy objects made in one function: the last is the one that is kept.
function seventy(i) {
  const a = [
    o("a0"), o("a1"), o("a2"), o("a3"), o("a4"), o("a5"), o("a6"), o("a7"), o("a8"), o("a9"),
    o("b0"), o("b1"), o("b2"), o("b3"), o("b4"), o("b5"), o("b6"), o("b7"), o("b8"), o("b9"),
    o("c0"), o("c1"), o("c2"), o("c3"), o("c4"), o("c5"), o("c6"), o("c7"), o("c8"), o("c9"),
  ];
  const l0 = { t: 0 }, l1 = { t: 1 }, l2 = { t: 2 }, l3 = { t: 3 }, l4 = { t: 4 }, l5 = { t: 5 }, l6 = { t: 6 }, l7 = { t: 7 }, l8 = { t: 8 }, l9 = { t: 9 };
  const m0 = { t: 10 }, m1 = { t: 11 }, m2 = { t: 12 }, m3 = { t: 13 }, m4 = { t: 14 }, m5 = { t: 15 }, m6 = { t: 16 }, m7 = { t: 17 }, m8 = { t: 18 }, m9 = { t: 19 };
  const n0 = { t: 20 }, n1 = { t: 21 }, n2 = { t: 22 }, n3 = { t: 23 }, n4 = { t: 24 }, n5 = { t: 25 }, n6 = { t: 26 }, n7 = { t: 27 }, n8 = { t: 28 }, n9 = { t: 29 };
  const q0 = { t: 30 }, q1 = { t: 31 }, q2 = { t: 32 }, q3 = { t: 33 }, q4 = { t: 34 }, q5 = { t: 35 }, q6 = { t: 36 }, q7 = { t: 37 }, q8 = { t: 38 }, q9 = { t: 39 };
  const last = { t: 1000 + i, tag: "the last of seventy " + i };
  if (i % 50 === 49) kept.push(last);
  return a.length + l0.t + l1.t + l2.t + l3.t + l4.t + l5.t + l6.t + l7.t + l8.t + l9.t + m0.t + m1.t + m2.t + m3.t + m4.t + m5.t + m6.t + m7.t + m8.t + m9.t + n0.t + n1.t + n2.t + n3.t + n4.t + n5.t + n6.t + n7.t + n8.t + n9.t + q0.t + q1.t + q2.t + q3.t + q4.t + q5.t + q6.t + q7.t + q8.t + q9.t + last.t;
}
let total = 0;
for (let i = 0; i < 100; i++) total += seventy(i);
console.log(total, churn(60), kept.map(k => k.tag).join());
kept.length = 0;

// Nine, ten, eleven keys are read; the last one is an accessor that keeps `this`.
function readsMany(p) {
  return p.k1 + p.k2 + p.k3 + p.k4 + p.k5 + p.k6 + p.k7 + p.k8 + p.k9 + p.k10 + p.k11;
}
function plainEleven(i) {
  return { k1: i, k2: 1, k3: 1, k4: 1, k5: 1, k6: 1, k7: 1, k8: 1, k9: 1, k10: 1, k11: 1 };
}
function spyingEleven(i) {
  return {
    k1: i, k2: 1, k3: 1, k4: 1, k5: 1, k6: 1, k7: 1, k8: 1, k9: 1, k10: 1,
    tag: "eleven keys " + i,
    get k11() {
      kept.push(this);
      return 1;
    },
  };
}
total = 0;
for (let i = 0; i < 200; i++) total += readsMany(i % 90 === 89 ? spyingEleven(i) : plainEleven(i));
console.log(total, churn(60), kept.map(k => k.tag).join());
kept.length = 0;

// What is kept lies five, six, seven reads deep in the parameter.
function keepsDeep(p, i) {
  if (i % 90 === 89) kept.push(p.a.b.c.d.e);
  if (i % 90 === 88) kept.push(p.a.b.c.d.e.f.g);
  return p.a.b.c.d.e.f.g.n;
}
function returnsDeep(p) {
  return p.a.b.c.d.e.f;
}
function storesDeep(p, value) {
  p.a.b.c.d.e.f.g = value;
}
const nest = i => ({ a: { b: { c: { d: { e: { tag: "e" + i, f: { tag: "f" + i, g: { tag: "g" + i, n: i } } } } } } } });
total = 0;
for (let i = 0; i < 200; i++) {
  total += keepsDeep(nest(i), i);
  const mine = nest(i);
  const f = returnsDeep(mine);
  storesDeep(mine, { tag: "replacement" + i, n: -1 });
  line = f.tag + " " + f.g.tag + " " + (mine.a.b.c.d.e.f === f);
}
console.log(total, line, churn(60), kept.map(k => k.tag + (k.f ? ">" + k.f.g.tag : "")).join());
kept.length = 0;

// A chain of calls longer than any walk: forty functions hand the object down, made at run time from one template so that each is a function of its own.
function hand(next) {
  return function (x, i) {
    return next(x, i);
  };
}
let bottom = (x, i) => {
  if (i % 90 === 89) kept.push(x);
  return x.n;
};
for (let depth = 0; depth < 40; depth++) bottom = hand(bottom);
total = 0;
for (let i = 0; i < 200; i++) total += bottom({ n: i, tag: "forty frames down " + i }, i);
console.log(total, churn(80), kept.map(k => k.tag).join());

// Thirty-four results: an array pattern takes them apart; the thirty-third is a parameter.
function manyResults(p) {
  return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, p, { tag: "fresh" }];
}
let sameCount = 0;
for (let i = 0; i < 100; i++) {
  const mine = o("mine" + i);
  const all = manyResults(mine);
  if (all[32] === mine && all[33] !== manyResults(mine)[33] && all[0] === 0) sameCount++;
}
console.log(sameCount);
