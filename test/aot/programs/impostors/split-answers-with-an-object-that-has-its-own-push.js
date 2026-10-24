const separator = { [Symbol.split]: () => ({ push: () => "pushed" }) };
console.log("a,b".split(separator).push(1));
