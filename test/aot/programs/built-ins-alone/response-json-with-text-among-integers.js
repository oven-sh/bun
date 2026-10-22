const result = Response.json("text", null);
console.log(result instanceof Response, Object.keys(result).join());
