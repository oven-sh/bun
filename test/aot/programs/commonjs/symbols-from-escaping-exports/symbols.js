"use strict";
const writeSym = Symbol("mini.write");
const streamSym = Symbol("mini.stream");
const serializersSym = Symbol.for("mini.serializers");
module.exports = { writeSym, streamSym, serializersSym };
