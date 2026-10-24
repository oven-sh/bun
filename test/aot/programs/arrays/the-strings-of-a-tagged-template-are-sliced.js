const tag = (strings, ...rest) => strings;
const part = tag`a${1}b`.slice(1);
console.log(typeof part[0], part[0] + "!");
