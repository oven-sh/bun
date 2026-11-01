Object.defineProperties(RegExp.prototype, Object.getOwnPropertyDescriptors({ get extra() { return 41; } }));
console.log(`${Reflect.get(new Proxy(/a/, {}), "extra")}`);
