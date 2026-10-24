const kept = [];
kept.push(function (list) {
  list.push(1);
  return list.length;
});
kept.push(function (text) {});
kept.push(function (n) {});
kept.push(function (n) {});
kept.push(function (f) {});
const makers = [() => new Proxy([5, 6], {})];
for (const make of makers) console.log("length", kept[0](make()));
