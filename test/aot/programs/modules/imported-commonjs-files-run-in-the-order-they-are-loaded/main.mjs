// What a module imports is loaded behind everything that was asked for before it, and a CommonJS file runs when it is loaded: second, third, fourth, first.
import "./a.mjs";
import "./second.cjs";
import "./d.mjs";
console.log("main");
