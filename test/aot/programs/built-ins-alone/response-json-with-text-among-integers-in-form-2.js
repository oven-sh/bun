const result = Response.json("text", "text");
console.log(result instanceof Response, Object.keys(result).join());
