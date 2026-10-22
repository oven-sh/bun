const global = new WebAssembly.Global({ value: "f64", mutable: true }, 1.5);
console.log(global.value + 1);
global.value = 2.5;
console.log(global.value + 1, global.valueOf() + 1);
