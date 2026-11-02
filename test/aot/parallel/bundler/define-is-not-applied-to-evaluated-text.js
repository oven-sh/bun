// Text that a program evaluates meets no `--define`: a name in it is the global of that name, also where the text declares the name that the define has for a value, calls the defined name or deletes it.
// Flags: --define NAME=target --define ROOT=holder.value --define RUN=eval --define process.env.ALIAS=target
globalThis.NAME = "the global NAME";
globalThis.ROOT = "the global ROOT";
globalThis.RUN = text => "the global RUN: " + text;
const name = new Function("const target = 'a binding of the text'; return NAME;");
const path = new Function("const holder = { value: 'a binding of the text' }; return ROOT;");
const call = new Function("var local = 1; return RUN('typeof local');");
const drop = new Function("'use strict'; const target = 1; return delete process.env.ALIAS;");
console.log(name(), path(), call(), drop());
