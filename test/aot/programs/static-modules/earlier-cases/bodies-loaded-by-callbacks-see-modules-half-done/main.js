// A hook loads plugins, and the BODY of each plugin requires a module that is still running: a barrel, a literal, a hoisted function, one function.
require("./x"); require("./hook");
const barrel = require("./barrel"), lit = require("./lit"), prologue = require("./prologue"), fn = require("./fn");
console.log(barrel.fromHook, barrel.g, "|", lit.fromHook, lit.l, "|", prologue.fromHook, prologue.f(), "|", fn.fromHook, fn(), require("./plugin_fn").later());
