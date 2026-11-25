const bytes = new Uint8Array([7, 8]);
const stops = [];
for (let holder = bytes; holder; holder = holder.__proto__) stops.push(Object.getOwnPropertyNames(holder).includes("at"));
console.log(stops.join());
let above = [Uint8Array.prototype, Map.prototype][JSON.parse("0")];
above = Reflect.getPrototypeOf(above);
console.log(typeof above.at, above.at.call(bytes, 0), typeof above.toLocaleString, above.toLocaleString.call(bytes));
