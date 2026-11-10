// Anything is sought in an empty list, and in a list of three holes: includes finds undefined in the holes alone.
const empty = JSON.parse("[]"), holes = new Array(JSON.parse("3"));
const sought = [...JSON.parse('[0,2.5,"a",null,true,{"a":1}]'), JSON.parse("[]")[0]];
for (let turn = 0; turn < 3; turn++)
  for (const list of [empty, holes])
    console.log("SAID", turn, list.length, sought.map(value => list.indexOf(value) + " " + list.includes(value)).join());
