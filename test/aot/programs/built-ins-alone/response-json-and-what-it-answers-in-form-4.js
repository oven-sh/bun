const result = Response.json(1.5, 2.5);
console.log(result instanceof Response, Object.keys(result).join());
