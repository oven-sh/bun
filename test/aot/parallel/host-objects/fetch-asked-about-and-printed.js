// Nothing here calls fetch. The table lists every member of the function, so what is asked about it and the printer of console.log find nothing that nobody knows.
// STATISTIC: ImageFunctionsEmitted <= 8
console.log(typeof fetch, typeof Bun.fetch, fetch === Bun.fetch);
if (typeof fetch !== "function") throw new Error("there is no fetch");
console.log(fetch.name, fetch.length, Bun.fetch.name, Bun.fetch.length);
console.log(Object.keys(fetch), Reflect.ownKeys(fetch), Object.keys(Bun.fetch));
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(fetch, "preconnect")));
console.log(typeof fetch.preconnect, fetch.preconnect.name, fetch.preconnect.length, fetch.preconnect === Bun.fetch.preconnect);
console.log(Object.getPrototypeOf(fetch) === Function.prototype, "preconnect" in fetch, "other" in fetch);
console.log(fetch);
console.log(Bun.fetch);
console.log(fetch.preconnect);
