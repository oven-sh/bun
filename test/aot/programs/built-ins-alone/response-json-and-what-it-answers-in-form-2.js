const result = Response.json(1.5, null);
console.log(result instanceof Response, Object.keys(result).join());
