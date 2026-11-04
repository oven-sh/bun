// WebAssembly.instantiate() resolves with a new object of a module and an instance for bytes, and with an instance for a module.
const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const both = await WebAssembly.instantiate(bytes);
console.log(Object.keys(both).join(), both.module instanceof WebAssembly.Module, both.instance instanceof WebAssembly.Instance);
const alone = await WebAssembly.instantiate(both.module);
console.log(alone instanceof WebAssembly.Instance, alone === both.instance, typeof alone.exports, alone.module);
const { module } = await WebAssembly.instantiate(bytes);
module.constructor.exports = () => "mine";
console.log(WebAssembly.Module.exports(module));
alone.constructor.marked = "also mine";
console.log(WebAssembly.Instance.marked);
for (const odd of [undefined, 1, {}, new Uint8Array(2)]) console.log(await WebAssembly.instantiate(odd).then(() => "resolved", error => error.name));
