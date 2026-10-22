const headers = new Headers({ a: "1" });
console.log(headers.get("a"), headers.has("b"));
headers.set("a", "2");
headers.append("b", "3");
console.log(headers.get("a"), headers.has("b"));
headers.delete("a");
console.log(headers.get("a") === null, [...headers.keys()].join());
