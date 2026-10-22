const result = Response.json("an", 2.5);
console.log(result instanceof Response, Object.keys(result).join());
