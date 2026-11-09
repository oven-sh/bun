// Flags: --react-compiler
// The body of such an arrow holds no list of statements in which the function that is moved out could be declared. It gets one.
const rate = 100, label = "outer", scale = 100;
const make = (rate) => function (items) { "use memo"; return items.map(n => n * rate).join("+"); };
const withLabel = (label) => (scale) => function (items) { "use memo"; return items.map(n => label + n * scale).join("+"); };
const all = (rates) => rates.map(rate => function (items) { "use memo"; return items.map(n => n * rate).join("+"); });
const later = async (rate) => function (items) { "use memo"; return items.map(n => n * rate).join("+"); };
const short = (rate) => (items) => { "use memo"; return items.map(n => n * rate).join("+"); };
const pair = (rate) => [function (items) { "use memo"; return items.map(n => n * rate).join("+"); }, function (items) { "use memo"; return items.map(n => n + rate).join("-"); }];
console.log(make(3)([1, 2]), withLabel("a")(3)([1, 2]), withLabel("b")(4)([1, 2]));
console.log(all([3, 4]).map(bill => bill([1, 2])).join(), (await later(5))([1, 2]), short(6)([1, 2]), pair(7).map(bill => bill([1, 2])).join());
