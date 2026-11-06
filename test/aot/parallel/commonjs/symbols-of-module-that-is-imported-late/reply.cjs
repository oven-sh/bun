"use strict";
const { kState, kHeaders, kSent, kMissing } = require("./symbols.cjs");
function Reply(raw) {
  this.raw = raw;
  this[kState] = 0;
  this[kHeaders] = null;
  this[kSent] = false;
}
Object.defineProperties(Reply.prototype, {
  sent: {
    get() {
      return this[kSent] === true;
    },
  },
});
Reply.prototype.code = function (state) {
  this[kState] = state;
  return this;
};
Reply.prototype.header = function (name, value) {
  (this[kHeaders] ??= {})[name] = value;
  return this;
};
Reply.prototype.send = function (text) {
  if (this.sent) throw new Error("sent twice");
  this[kSent] = true;
  this.raw.push(this[kState] + " " + JSON.stringify(this[kHeaders]) + " " + text);
  return this;
};
// No module exports the name: the key is undefined, and the property has the name "undefined".
Reply.prototype.lost = function (value) {
  this[kMissing] = value;
  return kMissing in this && "undefined" in this && this[kMissing] === this.undefined;
};
Reply.describe = function (reply) {
  return Reflect.ownKeys(reply).map(String).join(",") + " | " + Object.keys(reply).join(",") + " | " + (kState in reply) + " " + Object.hasOwn(reply, kSent) + " " + delete reply[kHeaders] + " " + (kHeaders in reply);
};
module.exports = Reply;
