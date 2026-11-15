// What is no number is sought in a list of whole numbers: a text that reads like one of them, null, a truth value, an object, what is not a number, an infinity.
const list = JSON.parse("[0,1,12,-7]");
const sought = [...JSON.parse('["12",null,true,false,{"a":1},[12]]'), Number(JSON.parse('"x"')), JSON.parse("1e999"), -JSON.parse("1e999")];
for (let turn = 0; turn < 3; turn++)
  console.log("SAID", turn, sought.map(value => list.indexOf(value) + " " + list.includes(value)).join());
