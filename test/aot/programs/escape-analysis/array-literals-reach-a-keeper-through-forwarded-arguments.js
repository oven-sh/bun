// An array literal is made for one call, and the callee never names its parameter: it hands all its arguments on, by apply, by a spread of a rest parameter, by super(...arguments), or reads one of them by an index that is a variable. Whoever gets the list in the end keeps it.
// Deep calls and a collection follow, so that a list that went with the frame of its maker would be seen. The output is that of plain Bun.
const kept = [];
function keeps(list) {
  kept.push(list);
  return list.length;
}
function forwardsByApply(list) {
  return keeps.apply(null, arguments);
}
function forwardsByReflect(list) {
  return Reflect.apply(keeps, null, arguments);
}
function forwardsRest(...rest) {
  return keeps(...rest);
}
function forwardsSpreadArguments(list) {
  return keeps(...arguments);
}
function readsByVariable(list, index) {
  kept.push(arguments[index]);
  return index + 3;
}
class Base {
  constructor(list) {
    kept.push(list);
    this.count = list.length;
  }
}
class ForwardsToSuper extends Base {
  constructor(list) {
    super(...arguments);
  }
}
class ForwardsWithoutConstructor extends Base {}
function goesDeep(depth) {
  return depth ? goesDeep(depth - 1) + 1 : 0;
}
const makers = [
  text => forwardsByApply([text, "b", "c"]),
  text => forwardsByReflect([text, "b", "c"]),
  text => forwardsRest([text, "b", "c"]),
  text => forwardsSpreadArguments([text, "b", "c"]),
  (text, round) => readsByVariable([text, "b", "c"], round & 0),
  text => new ForwardsToSuper([text, "b", "c"]).count,
  text => new ForwardsWithoutConstructor([text, "b", "c"]).count,
];
let sum = 0;
for (let round = 0; round < 3000; round++) {
  for (const make of makers) sum += make("s" + round, round);
  if ((round & 255) === 0) goesDeep(500);
}
Bun.gc(true);
console.log(sum, kept.length);
for (const index of [0, 1, 2, 3, 4, 5, 6, 7 * 1500 + 3, kept.length - 1]) console.log(kept[index].join(), kept[index].length);
