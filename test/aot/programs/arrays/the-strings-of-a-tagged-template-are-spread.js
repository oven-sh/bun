const tag = (strings, ...rest) => [...strings];
const list = tag`a${1}b`;
console.log(typeof list[0], list.map(part => part.length).join());
