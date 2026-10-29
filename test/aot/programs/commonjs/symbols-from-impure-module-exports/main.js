// What a package's modules take out of an exports literal ahead of its escape is what the literal was made with, if the module that makes it is evaluated again after an evaluation that failed where the stack ends: that holds for a body that only makes values. A body that does anything more is evaluated once, and after such a failure its exports are empty: what is taken out of them stays a value that is read.
// IR= 1 readUnderAMakerOfValuesAlone PropGet v[0-9]+ name=UniqueSymbol "[^"]*alone"
// IR= 1 readUnderAMakerThatDoesMore ElemGet
"use strict";
const alone = require("./gathers-alone");
const more = require("./gathers-more");
console.log([alone.user.readUnderAMakerOfValuesAlone({ [alone.keys.kAlone]: "alone" }), more.user.readUnderAMakerThatDoesMore({ [more.keys.kMore]: "more" }), more.keys.made, Object.keys(alone.keys).join(), Object.keys(more.keys).join()].join());
