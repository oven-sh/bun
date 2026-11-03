// A definition of a key of require.cache that leaves it a writable, enumerable and configurable data property is a store, as an assignment is:
// require() answers with what the entry exports. The build reads the assignment, so a key that is defined is one that is assigned here too.
const held = require("bun:sqlite");
const ask = () => require("bun:sqlite").fake + " " + typeof require("bun:sqlite").Database;
const entry = value => ({ value, writable: true, enumerable: true, configurable: true });
console.log("before", ask());
require.cache["bun:sqlite"] = { exports: { fake: "assigned" } };
console.log("assigned", ask());
const defined = { exports: { fake: "defined" } };
Object.defineProperty(require.cache, "bun:sqlite", entry(defined));
console.log("defined", ask(), require.cache["bun:sqlite"] === defined, typeof held.Database);
require.cache.ws = undefined;
console.log("Reflect", Reflect.defineProperty(require.cache, "ws", entry({ exports: { fake: "a fake ws" } })), require("ws").fake);
Object.defineProperty(require.cache, "bun:sqlite", { value: { exports: { fake: "only a value" } } });
console.log("only a value", ask(), JSON.stringify(Object.keys(Object.getOwnPropertyDescriptor(require.cache, "bun:sqlite")).sort()));
delete require.cache["bun:sqlite"];
delete require.cache.ws;
console.log("deleted", ask(), typeof require("ws").WebSocket);
