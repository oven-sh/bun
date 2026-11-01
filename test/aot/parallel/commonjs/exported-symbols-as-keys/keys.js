"use strict";

const kBare = Symbol();

module.exports = {
    kState: Symbol("state"),
    kCount: Symbol("count"),
    kShared: Symbol.for("shared by its text"),
    kBare,
};
