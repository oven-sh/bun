// STATISTIC: VariableReceiverGuardsHoisted >= 1
const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const parsed = JSON.parse('{"numbers":[1.5,2,3.25,4],"whole":[1,2,3,4],"texts":["a","b","c","d"],"mixed":[1,"b",3.5,null],"holes":[1,2,3,4]}');
const say = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
function make() { let held = parsed.numbers; return { sum(turns) { let s = 0; for (let i = 0; i < turns; i++) s += held[i]; return s; }, sumAndSwap(turns, swap) { let s = 0; for (let i = 0; i < turns; i++) { s += held[i]; swap(i); } return s; }, set(next) { held = next; } }; }
const one = make(), other = make();
say(one[unseen("sum")](4)); one[unseen("set")](parsed.texts); say(one[unseen("sum")](4), other[unseen("sum")](4)); one[unseen("set")](new Uint8Array([1, 2, 3, 4])); say(one[unseen("sum")](4));
other[unseen("set")](parsed.whole); say(other[unseen("sumAndSwap")](4, (i) => { if (i === 1) other[unseen("set")](parsed.mixed); }));
