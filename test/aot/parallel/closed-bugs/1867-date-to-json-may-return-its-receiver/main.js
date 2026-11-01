// Flags: --aot-validate
const holder = { toISOString: Object.prototype.valueOf }; console.log(Date.prototype.toJSON.call(holder) === holder);
