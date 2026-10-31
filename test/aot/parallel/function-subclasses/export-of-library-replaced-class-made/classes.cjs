const { Readable } = require("node:stream");
const { EventEmitter } = require("node:events");
exports.Reader = class Reader extends Readable { constructor() { super(); this.mine = 1; } };
exports.Bus = class Bus extends EventEmitter { constructor() { super(); this.mine = 2; } };
