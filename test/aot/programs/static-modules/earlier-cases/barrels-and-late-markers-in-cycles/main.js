// A barrel of getters and a late `__esModule`, each looked at from inside a cycle.
const barrel = require("./barrel"), user = require("./user");
console.log(barrel.e, barrel.l, barrel.seen, user.later());
const latemark = require("./latemark"), peer = require("./peer");
console.log(latemark.peerSaw, peer.later());
