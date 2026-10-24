const pattern = { [Symbol.match]: () => ({ join: () => "joined" }) };
console.log("a,b".match(pattern).join());
