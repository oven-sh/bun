// Symbol lists its keys in one order whether or not a variable of the environment was read before.
const variable = process.argv.length > 99 ? process.env.A_VARIABLE_THAT_NOBODY_SETS : undefined;
if (Symbol.keyFor) Object.entries(Symbol);
console.log(variable, Reflect.ownKeys(Symbol).slice(-2).join());
