// The headers of a Request are copied under keys that are made at run time. A read under such a key may find what every object inherits, functions among them. The constructor asks the body alone for an async iterator and iterates the headers alone.
// STATISTIC: ImageFunctionsEmitted <= 30
const store = { ACCEPT: "text/plain" };
const copy = {};
for (const name of JSON.parse('["accept"]')) copy[name] = store[name.toUpperCase()];
console.log(new Request("http://localhost/", { headers: copy }).headers.get("accept"));
