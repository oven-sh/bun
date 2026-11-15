// STATISTIC: SiteReadsInFusedChains >= 4
// map() of records off JSON into other records, in functions that a loop calls: the fields are read at their sites, and the callback runs where a site cannot answer.

let seen = 0;
function pick(list, turn) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.map(x => ({ id: x.id, label: x.name }));
}
function destructure(list, turn) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.map(({ id, name }) => ({ id, name }));
}
function show(list) {
  return list.length + ":" + list.map(x => JSON.stringify(x)).join("/");
}
const records = length => JSON.parse(JSON.stringify(Array.from({ length }, (_, i) => ({ id: i, name: "n" + i, half: i / 2 }))));
const lists = JSON.parse("[]");
for (const length of [0, 1, 4, 7]) lists.push(records(length));
const changes = [
  list => list.push(JSON.parse('{"name":"first","z":1,"id":9}')),
  list => list.push(null),
  list => Object.setPrototypeOf(list[0] ?? list, null),
  list => list.push(new Proxy({ id: 5, name: "p" }, { get: (target, key) => (seen++, target[key]) })),
];
function ask(lists) {
  for (let round = 0; round < 8; round++) {
    for (let place = 0; place < lists.length; place++) {
      const list = lists[place];
      if (round === 5) changes[place](list);
      try {
        console.log(round, show(pick(list, round)));
      } catch (error) {
        console.log(round, error.constructor.name);
      }
      try {
        console.log(round, show(destructure(list, round)));
      } catch (error) {
        console.log(round, error.constructor.name);
      }
    }
  }
}
ask(lists);
console.log(seen);
