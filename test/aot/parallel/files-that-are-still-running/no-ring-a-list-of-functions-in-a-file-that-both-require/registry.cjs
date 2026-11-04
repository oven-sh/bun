"use strict";
const hooks = [];
exports.add = function (hook) { hooks.push(hook); };
exports.run = function () { return hooks.map((hook) => hook()).join(","); };
