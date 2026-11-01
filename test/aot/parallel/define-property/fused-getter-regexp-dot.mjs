Object.defineProperties(RegExp.prototype, Object.getOwnPropertyDescriptors({ get extra() { return 41; } }));
console.log(`${new Proxy(/a/, {}).extra}`);
