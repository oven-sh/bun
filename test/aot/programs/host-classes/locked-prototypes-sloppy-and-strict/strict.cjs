"use strict";
exports.attempts = [
  ["replaces a method", function (prototype, method) { prototype[method] = function () {}; return "no error"; }],
  ["adds a property", function (prototype) { prototype.added = 1; return "no error"; }],
  ["adds an index", function (prototype) { prototype[7] = 1; var added = 7 in prototype; delete prototype[7]; return added ? "added" : "no error"; }],
  ["deletes a method", function (prototype, method) { return delete prototype[method]; }],
  ["deletes a missing property", function (prototype) { return delete prototype.missing; }],
  ["defines a method", function (prototype, method) { Object.defineProperty(prototype, method, { value: function () {} }); return "no error"; }],
  ["sets __proto__", function (prototype) { prototype.__proto__ = {}; return "no error"; }],
  ["sets by Reflect", function (prototype, method) { return Reflect.set(prototype, method, function () {}); }],
  ["is this sloppy code", function () { return this === undefined ? "strict" : "sloppy"; }],
];
