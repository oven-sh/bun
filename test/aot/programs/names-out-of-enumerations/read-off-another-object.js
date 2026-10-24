// The name comes out of one object and is looked for in another.
function copy(names, from) {
  const found = [];
  for (const name in names) found.push(name, typeof from[name], from[name] === Object);
  return found.join();
}
console.log(copy({ constructor: 1, toString: 1, a: 1 }, { a: 2 }));
console.log(copy(JSON.parse('{"constructor":1,"__proto__":2,"valueOf":3}'), { a: 2 }));
function sameTextOtherValue(o, other) {
  const found = [];
  for (const name in o) { const target = found.length ? other : o; found.push(typeof target[name]); }
  return found.join();
}
console.log(sameTextOtherValue({ a: 1, constructor: 2 }, {}));
