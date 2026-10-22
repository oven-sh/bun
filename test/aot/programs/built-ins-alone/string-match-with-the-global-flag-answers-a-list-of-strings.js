const match = "banana".match(/an/g);
console.log(match.length, match[1].length, match.index === undefined, match.groups === undefined);
