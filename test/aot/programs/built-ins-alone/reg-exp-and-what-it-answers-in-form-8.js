const result = new RegExp(null, undefined);
console.log(result instanceof RegExp, result.source, result.flags, result.lastIndex);
