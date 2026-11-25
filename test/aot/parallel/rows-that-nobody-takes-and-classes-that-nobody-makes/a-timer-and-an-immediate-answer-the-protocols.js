const bell = setTimeout(() => {}, 1);
console.log(typeof +bell, `${bell}`.length > 0, typeof bell[Symbol.toPrimitive], bell.constructor.name, typeof bell[Symbol.dispose], bell.hasRef());
clearTimeout(bell);
const soon = setImmediate(() => {});
console.log(soon.constructor.name, typeof soon[Symbol.dispose], soon.hasRef());
clearImmediate(soon);
