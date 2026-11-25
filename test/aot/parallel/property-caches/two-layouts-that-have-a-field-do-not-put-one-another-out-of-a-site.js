// One read sees three layouts: one that lacks the name comes first and its answer takes the second answer of the place. The two that have the field then come in turn: neither may put the other out of the one answer
// by shape at every miss, for ever: the later one is filed by its structure among the further answers, and the place is asked to be filled a dozen times, not a thousand.
// COUNT: operation:operationAOTFillSiteAnswers <= 100
const hidden = JSON.parse('{"door":"paint"}');
function paint(props) { return (props.pad | 0) + 1; }
function d1(x) { return 1; }
function d2(x) { return x === 2 ? 2 : 3; }
function d3(x) { return typeof x; }
function d4(x) { return [x]; }
function d5(x) { return { x }; }
function d6(x) { return String(x); }
const doors = { paint, d1, d2, d3, d4, d5, d6 };
const lacks = { direction: "row", wide: 80 };
const one = { pad: 1, grow: 1 };
const other = { pad: 2, children: null };
let sum = 0;
for (let i = 0; i < 400; i++) sum += doors[hidden.door](lacks);
for (let i = 0; i < 60000; i++) sum += doors[hidden.door](i & 1 ? one : other) + doors[hidden.door](lacks);
console.log(sum);
