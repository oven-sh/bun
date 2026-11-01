// Flags: --aot-validate
const d = Object.getOwnPropertyDescriptor(process.env, 'TZ');
console.log(typeof d.get, d.get === undefined, typeof d.set, typeof d.value, d.value === undefined, 'get' in d, 'value' in d, d.writable, d.enumerable);
const get = d.get;
console.log(get ? 'has a getter' : 'has none', get?.name, get instanceof Function);
if (d.get !== undefined) console.log('reached'); else console.log('not reached');
