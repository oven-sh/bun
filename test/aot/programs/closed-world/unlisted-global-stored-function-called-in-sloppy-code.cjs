globalThis.__calledInSloppyCode = function () { return this === globalThis ? "this is the global object" : typeof this; };
console.log(__calledInSloppyCode(), globalThis.__calledInSloppyCode(), (0, globalThis.__calledInSloppyCode)());
with (globalThis) { console.log(__calledInSloppyCode()); }
