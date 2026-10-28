// Closures made in a loop over the keys of an object are copied into a second list, which findLastIndex walks. Each is handed to a helper that calls it and
// then calls what it answers. The helper is also reached through Reflect.apply with another closure.
function callTwice(each: () => () => number) {
  return { held: each() }.held();
}
const walk = () => {
  const made: (() => () => number)[] = [];
  for (const name in { a: 1, bc: 2, def: 3 }) made.push(() => () => name.length);
  return made.slice(0, 3).findLastIndex(each => callTwice(each) % 2 === 1);
};
let sum = 0;
for (let turn = 0; turn < 300; turn++) sum += walk();
console.log(sum);
console.log(Reflect.apply(callTwice, undefined, [() => () => 5]));
