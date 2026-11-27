function put(given, name, laid) { given[name] = laid; }
put(Date, "now", () => 7);
console.log(Date.now());
