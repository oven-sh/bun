const store = (holder, at, value) => { try { holder[at] = value; return "stored"; } catch (error) { return error.constructor.name; } };
const steps = holder => {
  const said = [];
  holder[JSON.parse('"early"')] = 0;
  for (const item of JSON.parse("[1,2,3,4]")) Array.prototype.push.call(holder, item);
  for (const item of JSON.parse('[5,2.5,7,"text",null]')) said.push(store(holder, 1, item) + ":" + typeof holder[1] + ":" + holder[1] + ":" + holder[2]);
  Object.preventExtensions(holder);
  said.push(store(holder, 2, 0.5) + ":" + holder[2], store(holder, 9, 0.5) + ":" + holder[9]);
  said.push(Object.keys(holder).join(), JSON.stringify(holder));
  return said.join(" ");
};
const turns = Number(process.argv[2] ?? 3);
for (let turn = 0; turn < turns; turn++) console.log("SAID", steps({ length: 0 }));
