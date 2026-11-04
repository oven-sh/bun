// A copy and the names written behind it are made of an object that no code of the program has made.
function deed(source, label) {
  return { ...source, label, size: 1 };
}
function both(first, second) {
  return { ...first, ...second };
}
const parsed = text => JSON.parse(text);
console.log(JSON.stringify(deed(parsed('{"b":1,"label":"own","a":2,"1":"index"}'), "given")));
console.log(JSON.stringify(both(parsed('{"b":1,"a":2}'), parsed('{"c":3,"b":4,"0":5}'))));
console.log(Object.keys(deed(parsed("{}"), 0)).join(), Object.keys(both(parsed("{}"), parsed("{}"))).length);
let last = "";
for (let i = 0; i < 300; i++) last = JSON.stringify(deed(parsed(i % 2 ? '{"a":1}' : '{"z":1,"size":9}'), i)) + JSON.stringify(both(parsed('{"a":1}'), parsed(i % 2 ? '{"a":2}' : '{"q":3}')));
console.log(last);
