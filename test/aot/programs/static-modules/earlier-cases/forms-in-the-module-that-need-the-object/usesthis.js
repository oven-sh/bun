"use strict";
exports.name = "usesthis";
exports.who = function () { return this === exports ? "exports:" + this.name : "other:" + (this === undefined ? "undefined" : this === globalThis ? "global" : typeof this); };
exports.callsOwn = function () { return exports.who(); };
