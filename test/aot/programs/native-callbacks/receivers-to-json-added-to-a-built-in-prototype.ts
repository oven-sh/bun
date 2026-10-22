// Receivers below an accessor and stores into the realm: a toJSON function that the program adds to BigInt.prototype is called by JSON.stringify with a primitive bigint as `this` and the key as its argument.
let total = 0;

function bigintToJSON(this: bigint, key: string): string {
  total += typeof this === "bigint" ? 1 : typeof this === "object" ? 100 : 10000;
  total += typeof key === "string" ? 1000000 : 100000000;
  return this.toString() + "n";
}

(BigInt.prototype as any).toJSON = bigintToJSON;
const text = JSON.stringify({ a: 1n, list: [2n, Object(3n)], nested: { b: -4n } });
console.log(total, text);
