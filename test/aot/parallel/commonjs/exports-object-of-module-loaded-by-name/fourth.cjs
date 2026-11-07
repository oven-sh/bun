"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.name = exports.same = void 0;
exports.name = "fourth";
exports.same = this === exports && module.exports === exports;
exports.read = () => exports.name;
module.exports.throughModule = exports.name;
this.throughThis = module.exports.throughModule;
