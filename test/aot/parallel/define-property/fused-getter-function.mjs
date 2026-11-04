Object.defineProperties(Function.prototype, Object.getOwnPropertyDescriptors({ get extra() { return 41; } }));
console.log(`${Reflect.get(new Proxy(function () {}, {}), "extra")}`);
