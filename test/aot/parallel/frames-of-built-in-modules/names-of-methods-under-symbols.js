// Under: --obfuscate: a method of a class of a built-in module that a symbol names has its name
// Under: --sourcemap=external: every name stays
const { AssertionError } = require("node:assert");
const { Channel } = require("node:diagnostics_channel");
const { inspect } = require("node:util");
const vm = require("node:vm");
const { Database } = require("bun:sqlite");

const database = new Database(":memory:");
const statement = database.prepare("SELECT 1 AS one");
const namesUnderSymbols = object => Reflect.ownKeys(object).filter(key => typeof key === "symbol" && typeof Object.getOwnPropertyDescriptor(object, key).value === "function").map(key => object[key].name);
console.log(Channel[Symbol.hasInstance].name);
console.log(AssertionError.prototype[inspect.custom].name);
console.log(vm.Module.prototype[inspect.custom].name);
console.log(namesUnderSymbols(Object.getPrototypeOf(statement)));
statement.finalize();
database.close();
