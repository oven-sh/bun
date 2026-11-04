Object.defineProperties(Array.prototype, Object.getOwnPropertyDescriptors({ get extra() { return 41; } }));
console.log(`${Reflect.get(new Proxy([1, 2], {}), "extra")}`);
