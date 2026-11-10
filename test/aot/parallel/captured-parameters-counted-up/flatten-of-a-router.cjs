// `index` is a parameter, the body counts it up and a closure made behind it captures it: what path-to-regexp 8 does, and with it express 5 and @koa/router. The build stopped: the birth of the scope was held to a type that the parameter was not proven to have yet.
function flatten(tokens, index, result, callback) {
  while (index < tokens.length) {
    const token = tokens[index++];
    if (Array.isArray(token)) {
      for (const part of token) flatten([part], 0, result.slice(), seq => flatten(tokens, index, seq, callback));
      return;
    }
    result.push(token);
  }
  callback(result);
}
const out = [];
flatten(JSON.parse('["a",["b","c"],"d"]'), 0, [], result => out.push(result.join("")));
console.log(out.join());
