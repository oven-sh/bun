// reads the value and the flags out of the own property descriptor of a plain object under a key that varies
const operations = 100;
const keys = ["a", "b", "c", "d"];
const holder: Record<string, unknown> = JSON.parse('{"a":1,"b":"two","c":null,"d":[4]}');
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(holder, keys[i & 3]);
    if (descriptor && descriptor.enumerable && descriptor.writable && descriptor.value !== null) total++;
  }
}

console.log(total);
