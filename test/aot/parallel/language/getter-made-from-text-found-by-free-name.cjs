// A getter of the global object that `new Function` made returns `this`, and a free name reads it.
Object.defineProperty(globalThis, "getterFromText", { configurable: true, get: new Function("return this") });
console.log(getterFromText === globalThis, getterFromText === globalThis, globalThis.getterFromText === globalThis);
