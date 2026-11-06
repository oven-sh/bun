// Array.from takes undefined for no mapper at all: the list holds undefined at each index, and no hole.
function make(mapper) {
  return Array.from({ length: 2 }, mapper);
}
const list = make();
console.log(list.length, 0 in list, Object.keys(list).join(), list.indexOf(undefined), list.filter(() => true).length);
console.log(list.map(value => typeof value).join(), JSON.stringify(list), new Set(list).has(undefined));
