// Names that no class lists, read together in a loop off instances that Object.assign gave them.
// STATISTIC: NamesReadOutsideFields >= 1
// STATISTIC: SiteCachedReadGroupsEmitted >= 1
class Entry { constructor(o) { Object.assign(this, o); } }
var entries = []; for (var i = 0; i < 16; i++) entries.push(new Entry(JSON.parse('{"first":' + i + ',"second":1}')));
function total(k) { var s = 0; for (var i = 0; i < k; i++) { var o = entries[i & 15]; s = (s + o.first + o.second) | 0; } return s; }
console.log(total(5), total(400), total(400));
function replace(place, text) { entries[place] = new Entry(JSON.parse(text)); console.log(text, total(5), total(400), total(16)); }
replace(3, '{"first":0.5,"second":1}');
replace(4, '{"first":4,"second":"7"}');
replace(5, '{"second":2,"first":3,"third":4}');
replace(6, "{}");
replace(7, '{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"first":8,"h":9,"second":10}');
replace(8, '{"first":null,"second":true}');
replace(9, '{"first":2147483647,"second":2147483647}');
replace(10, '{"first":{"second":1},"second":[3]}');
Bun.gc(true);
console.log(total(5), total(400), total(16), Object.keys(entries[7]).join());
for (i = 0; i < 16; i++) replace(i, '{"first":' + i + ',"second":-1}');
