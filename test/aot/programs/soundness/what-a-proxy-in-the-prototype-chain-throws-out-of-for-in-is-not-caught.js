const proxy = new Proxy({}, { ownKeys() { throw "expected exception"; } });
const heir = Object.create(proxy);
try { for (const key in heir) { } } catch (error) { console.log("caught", error); }
