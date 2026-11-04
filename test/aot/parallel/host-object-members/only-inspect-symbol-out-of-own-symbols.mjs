// The symbol is found among the own symbols of two prototype objects of the host.
const symbols = Object.getOwnPropertySymbols(URL.prototype).concat(Object.getOwnPropertySymbols(Buffer.prototype));
const custom = symbols.find(symbol => String(symbol).includes("inspect"));
console.log(String(custom), { [custom]() { return "mine"; } });
