// One compiled store site adds a name that shadows an array method to several arrays that already have named storage: every array must then use its own property.
function addByName(list) { list.tag = 1; list.push = function () { return -1; }; return list; }
function addByKey(list, key, value) { list.tag = 1; list[key] = value; return list; }
function addOtherName(list) { list.tag = 1; list.other = 2; return list; }
class ReturnsArgument { constructor(list) { list.tag = 1; return list; } }
class DefinesJoin extends ReturnsArgument { join = () => "own join"; }
for (let round = 1; round <= 4; round++) {
  const byName = addByName([round]);
  console.log(round, "by name", byName.push(3), byName.length);
  console.log(round, "by key", addByKey([round], "indexOf", () => "own indexOf").indexOf(round));
  console.log(round, "by symbol", [...addByKey([round], Symbol.iterator, function* () { yield "own iterator"; })].join());
  console.log(round, "toJSON", JSON.stringify(addByKey([round], "toJSON", () => "own toJSON")));
  console.log(round, "defined", String(new DefinesJoin([round, round])));
  const other = addOtherName([round]);
  console.log(round, "other name", other.push(3), other.length, other.other);
}
