// A CommonJS module that only makes values and cannot throw keeps its exports in variables that are never read before they are stored. One that reads a constant ahead of its declaration throws at load: it is none of those.
// IR+ ^variable (g\d+) name="kSound" [\s\S]* = GetModuleVariable variable=\1 isKnownInitialized
// IR- ^variable (g\d+) name="kSound" [\s\S]* = GetModuleVariable variable=\1\b(?! isKnownInitialized)
// IR+ ^variable g\d+ name="kEarlyVar" 
// IR- ^variable (g\d+) name="kBroken" [\s\S]* = GetModuleVariable variable=\1 isKnownInitialized
// IR- ^variable (g\d+) name="kOfItself" [\s\S]* = GetModuleVariable variable=\1 isKnownInitialized
"use strict";
const lines = [];
function show(what, value) { lines.push(what + ": " + String(value)); }
function outcome(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
const { kSound, kCopy, made } = require("./sound-keys");
function read(object) { return object[kSound]; }
show("declared above", [read({ [kSound]: "sound" }), kCopy === kSound, made.name, typeof made()].join());
show("read too early", outcome(() => typeof require("./broken-keys").kBroken));
show("in its own initializer", outcome(() => typeof require("./keys-of-itself").kOfItself));
show("a var read too early", [typeof require("./early-var").kEarlyVar, String(require("./early-var").kLateVar)].join());
show("kept", [read].length);
console.log(lines.join("\n"));
