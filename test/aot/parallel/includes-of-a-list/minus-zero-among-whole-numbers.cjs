// -0 is sought in a list of whole numbers that holds 0, and in one that does not.
const [holds, lacks] = JSON.parse("[[5,0,12],[5,1,12]]");
const sought = JSON.parse("-0");
for (let turn = 0; turn < 3; turn++)
  for (const list of [holds, lacks])
    console.log("SAID", turn, Object.is(sought, -0), list.indexOf(sought), list.includes(sought));
