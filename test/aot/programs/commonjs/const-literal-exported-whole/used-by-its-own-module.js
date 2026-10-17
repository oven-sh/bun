"use strict";
const keys = {
    kOwn: Symbol("own"),
};
module.exports = keys;
module.exports = { exported: keys, own() { return keys.kOwn; } };
