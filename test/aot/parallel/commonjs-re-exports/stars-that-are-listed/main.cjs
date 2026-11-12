// The exports objects of the stars of swc, Rollup, Babel and esbuild as values: their names, in order, and what describes them.
const swc = require("./swc.cjs");
const rollup = require("./rollup.cjs");
const babel = require("./babel.cjs");
const esbuild = require("./esbuild.cjs");
for (const names of [swc, rollup, babel, esbuild]) {
    console.log(Object.keys(names).join(), names.__esModule, names.default);
    for (const name of Object.getOwnPropertyNames(names)) {
        const { enumerable, configurable, get, set } = Object.getOwnPropertyDescriptor(names, name);
        console.log(name, enumerable, configurable, typeof get, typeof set);
    }
    try {
        "use strict";
        delete names.own;
        console.log("own" in names);
    } catch (error) {
        console.log(error.constructor.name);
    }
}
console.log(new swc.Swc(1, 2).add(new swc.Own(3, 4)).y, new esbuild.Esbuild(1, 2).x);
