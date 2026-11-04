// a record that is written with a getter among its plain values is read under a text that arrives, between a store into a variable and the read of it; the getter stores into the variable
let last = "start";
function pick(name) {
  const table = { a: 1, get b() { last = "getter ran"; return 2; }, c: 3 };
  last = "before";
  const found = table[name];
  return found + ":" + last;
}
function asks(name) {
  const table = { a: 1, get b() { last = "getter ran"; return 2; }, c: 3 };
  last = "before";
  const found = name in table;
  return found + ":" + last;
}
const names = JSON.parse('["a", "b", "c", "d"]');
for (let turn = 0; turn < 3; turn++) {
  let line = "";
  for (let i = 0; i < names.length; i++)
    line += pick(names[i]) + " " + asks(names[i]) + " ";
  console.log(line);
}
