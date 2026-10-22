global.__throughGlobal = () => 1;
self.__throughSelf = () => 2;
console.log(globalThis.__throughGlobal(), globalThis.__throughSelf(), globalThis.globalThis === globalThis, globalThis.self === globalThis, typeof globalThis.globalThis.__throughGlobal);
