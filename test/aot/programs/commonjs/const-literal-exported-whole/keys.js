"use strict";

const keys = {
    kState: Symbol("state"),
    kCount: Symbol("count"),
    kShared: Symbol.for("shared by its text"),
    limit: 21,
    onlyReadThroughTheObject: 5,
    double(value) { return value * 2; },
};

module.exports = keys;
