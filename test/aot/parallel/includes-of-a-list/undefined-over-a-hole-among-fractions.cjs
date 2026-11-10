// undefined, and what is not a number, are sought in a list of fractions with a hole, and in one without: includes finds the hole for undefined alone.
const [holed, whole] = JSON.parse("[[0.5,1.5,2.5],[0.5,1.5,2.5]]");
delete holed[1];
const sought = [JSON.parse("[]")[0], Number(JSON.parse('"x"'))];
for (let turn = 0; turn < 3; turn++)
  for (const list of [holed, whole])
    console.log("SAID", turn, sought.map(value => list.indexOf(value) + " " + list.includes(value)).join());
