const tag = (strings, ...rest) => strings.filter(part => part.length > 0).join("+");
console.log(tag`a${1}${2}b`);
