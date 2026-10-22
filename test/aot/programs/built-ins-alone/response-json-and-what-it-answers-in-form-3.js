const result = Response.json("an", null);
console.log(result instanceof Response, Object.keys(result).join());
