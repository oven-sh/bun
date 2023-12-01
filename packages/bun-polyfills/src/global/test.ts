import testPoly from '../modules/test.js';

//! Not a polyfill
// This file is used for preloading into the polyfills test runner, due to Jest's and by extension Bun's,
// quirky global scope pollution behavior.

for (const key of Object.keys(testPoly)) {
    Reflect.set(globalThis, key, Reflect.get(testPoly, key));
}
// Let's just not bother with concurrent tests for now, it'll work fine without. (Node's { concurrency: # } option is quirky)
Reflect.set(Reflect.get(globalThis, 'describe'), 'concurrent', testPoly.describe);
Reflect.set(Reflect.get(globalThis, 'test'), 'concurrent', testPoly.test);
Reflect.set(Reflect.get(globalThis, 'it'), 'concurrent', testPoly.it);