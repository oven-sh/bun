// The constructor gets another parent, which has a Symbol.hasInstance.
function isRequest(x) { return x instanceof Request; }
function isStream(x) { return x instanceof ReadableStream; }
const values = [new Request("http://a/"), new ReadableStream(), {}, 5];
const ask = () => values.map(value => +isRequest(value) + "" + +isStream(value)).join();
for (let i = 0; i < 50; i++) ask();
console.log(ask());
const parent = Object.create(Function.prototype, { [Symbol.hasInstance]: { value: x => x === 5 } });
for (const constructor of [Request, ReadableStream]) { try { Object.setPrototypeOf(constructor, parent); console.log("moved"); } catch (error) { console.log("refused", error.name); } }
console.log(ask());
