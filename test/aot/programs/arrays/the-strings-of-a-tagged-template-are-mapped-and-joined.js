const tag = (strings, ...rest) => strings;
console.log(tag`a${1}b`.map(part => part + part).join());
