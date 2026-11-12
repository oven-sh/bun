// A number is sought in a list of fractions: a fraction that is there, one that is not, a whole number that lies there as a fraction's neighbor, 0 where -0 lies, what is not a number.
const list = JSON.parse("[0.5,2.5,-0,3,1e300]");
const sought = [...JSON.parse("[2.5,2.25,3,0,-0,1e300,7]"), Number(JSON.parse('"x"'))];
for (let turn = 0; turn < 3; turn++)
  console.log("SAID", turn, sought.map(value => list.indexOf(value) + " " + list.includes(value)).join());
