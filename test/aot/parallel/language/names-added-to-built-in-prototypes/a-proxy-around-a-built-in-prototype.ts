// What follows from the answer to isExtensible: what libraries and the language itself ask of a built-in prototype, and what the language holds a Proxy around it to. Object.prototype alone is not extensible.
const unseen = (0, eval)("(x) => x");
for (const [name, h] of [["Object.prototype", Object.prototype], ["Promise.prototype", Promise.prototype], ["RegExp.prototype", RegExp.prototype], ["Response.prototype", Response.prototype], ["Array.prototype", Array.prototype]] as [string, any][]) {
  console.log(name, Object.isExtensible(h), Object.isExtensible(unseen(h)), Reflect.isExtensible(unseen(h)), Reflect.preventExtensions(Object.create(h)), Object.isExtensible(Object.create(h)), Object.isExtensible(new Proxy(h, {})),
    (() => { try { return Reflect.isExtensible(new Proxy(h, { isExtensible: () => true })); } catch (e) { return (e as Error).name; } })(),
    (() => { try { return Reflect.getPrototypeOf(new Proxy(h, { getPrototypeOf: () => Array.prototype })) === Array.prototype; } catch (e) { return (e as Error).name; } })(),
    (() => { try { return Reflect.ownKeys(new Proxy(h, { ownKeys: (t) => [...Reflect.ownKeys(t), "more"] })).length - Reflect.ownKeys(h).length; } catch (e) { return (e as Error).name; } })(),
    (() => { try { return Reflect.has(new Proxy(h, { has: () => false }), "constructor"); } catch (e) { return (e as Error).name; } })(),
    (() => { try { return Reflect.setPrototypeOf(h, Object.getPrototypeOf(h)); } catch (e) { return (e as Error).name; } })());
}
/* Output:
Object.prototype false false false true true false TypeError TypeError TypeError TypeError true
Promise.prototype true true true true true true true true 1 false true
RegExp.prototype true true true true true true true true 1 false true
Response.prototype true true true true true true true true 1 false true
Array.prototype true true true true true true true true 1 false true
*/
