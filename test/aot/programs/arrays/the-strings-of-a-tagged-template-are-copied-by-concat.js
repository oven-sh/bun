const tag = (strings, ...rest) => strings;
const copy = tag`a${1}b`.concat();
console.log(typeof copy[0], copy[0], copy.length);
