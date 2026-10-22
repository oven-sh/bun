"use strict";
var count = (this && this.__count) || function (from) { return Object.keys(from).length; };
var made = require("./made.cjs");
for (var name in made) Object.defineProperty(exports, name, Object.getOwnPropertyDescriptor(made, name));
exports.count = count(made);
