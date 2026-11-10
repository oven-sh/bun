// The elements are whole numbers, then fractions: a fraction, a text, what is not a number are stored over them, and compiled code reads them back.
const bag = { length: 0 }; bag[JSON.parse('"early"')] = 0; for (const item of JSON.parse("[1,2,3,4]")) Array.prototype.push.call(bag, item);
const read = holder => { let text = ""; for (let i = 0; i < 4; i++) text += typeof holder[i] + ":" + holder[i] + " "; return text; };
for (const item of [...JSON.parse('[5,2.5,"text",null]'), Number(JSON.parse('"x"'))]) {
  bag.length = 1;
  Array.prototype.push.call(bag, item);
  console.log("SAID", read(bag), bag.length, Object.keys(bag).join(), JSON.stringify(bag));
}
