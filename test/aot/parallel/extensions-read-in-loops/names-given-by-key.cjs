// Names that no class lists, read together in a loop off instances that keys gave them.
class Entry { constructor(o) { Object.keys(o).forEach((k) => { this[k] = o[k]; }); } }
var entries = []; for (var i = 0; i < 16; i++) entries.push(new Entry({ first: i, second: 1, third: -2 }));
function total(k) { var s = 0; for (var i = 0; i < k; i++) { var o = entries[i & 15]; s += o.first; s += o.second; s += o.third; } return s; }
console.log(total(5), total(400), total(400));
for (i = 0; i < 40; i++) entries.push(new Entry({ first: i, second: 0.5, third: 2 }));
console.log(total(5), total(400), total(16));
entries[3].first = "text"; entries[4].fourth = 4; delete entries[5].second;
console.log(total(5), String(total(400)).length, String(total(6)));
entries[3].first = 3; Object.defineProperty(entries[6], "third", { get: function () { return 9; } });
Bun.gc(true);
console.log(String(total(5)), String(total(400)).length, String(total(8)), Object.keys(entries[4]).join());
