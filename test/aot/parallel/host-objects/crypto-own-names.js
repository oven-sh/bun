console.log(Object.keys(crypto).length, Object.getOwnPropertyNames(crypto).length, "extra" in crypto);
crypto.extra = 1;
Object.defineProperty(crypto, "hidden", { value: 2 });
function read() { const names = []; for (const name in crypto) names.push(name); return Object.keys(crypto).join() + " " + Object.getOwnPropertyNames(crypto).join() + " " + names.includes("extra") + " " + crypto.hidden; }
console.log(read());
