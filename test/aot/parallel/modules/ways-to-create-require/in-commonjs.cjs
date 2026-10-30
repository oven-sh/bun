const { createRequire } = require("module");
const readIntoVariable = require("node:module").createRequire;
const first = require("node:module");
const second = first;
const third = second.createRequire;
const fourth = third;
const ask = require;
const { Module } = require("node:module");
module.exports = [
  createRequire(__filename)("./lib.cjs"),
  readIntoVariable(__filename)("./lib.cjs"),
  fourth(__filename)("./lib.cjs"),
  module.require("node:module").createRequire(__filename)("./lib.cjs"),
  ask("node:module").createRequire(__filename)("./lib.cjs"),
  require.call(null, "module").createRequire(__filename)("./lib.cjs"),
  Module.createRequire(__filename)("./lib.cjs"),
  require("node:module").Module.createRequire(__filename)("./lib.cjs"),
];
