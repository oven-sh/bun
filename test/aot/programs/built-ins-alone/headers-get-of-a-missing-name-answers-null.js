const headers = new Headers({ first: "1" });
console.log(headers.get("missing") === null, headers.get("FIRST").length, headers.has("first"), [...headers].length, [...headers][0][1].length);
