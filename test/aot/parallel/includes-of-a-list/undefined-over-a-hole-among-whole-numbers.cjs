// undefined is sought in a list of whole numbers with a hole, and in one without: includes finds the hole, indexOf passes it over.
const [holed, whole] = JSON.parse("[[5,1,12],[5,1,12]]");
delete holed[1];
const sought = JSON.parse("[]")[0];
for (let turn = 0; turn < 3; turn++)
  for (const list of [holed, whole])
    console.log("SAID", turn, list.indexOf(sought), list.includes(sought));
