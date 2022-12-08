const headers = new Headers();
headers.append("Set-Cookie", "a=1");
headers.append("Set-Cookie", "b=1; Secure");

console.log(headers.getAll("Set-Cookie")); // ["a=1", "b=1; Secure"]
console.log(headers.toJSON()); // { "set-cookie": "a=1, b=1; Secure" }
