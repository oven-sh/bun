// A definition of a key of require.cache that leaves it a writable, enumerable and configurable data property is a store, as an assignment is:
// require() answers with what the entry exports.
const held = require("bun:sqlite");
const ask = () => require("bun:sqlite").fake + " " + typeof require("bun:sqlite").Database;
const entry = value => ({ value, writable: true, enumerable: true, configurable: true });
console.log("before", ask());
const defined = { exports: { fake: "sqlite" } };
Object.defineProperty(require.cache, "bun:sqlite", entry(defined));
console.log("defined", ask(), require.cache["bun:sqlite"] === defined, typeof held.Database);
console.log("Reflect", Reflect.defineProperty(require.cache, "ws", entry({ exports: { fake: "a fake ws" } })), require("ws").fake);
delete require.cache["bun:sqlite"];
delete require.cache.ws;
console.log("deleted", ask(), typeof require("ws").WebSocket);
