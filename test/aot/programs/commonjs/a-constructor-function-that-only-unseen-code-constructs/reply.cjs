"use strict";
const kState = Symbol("state"), kSent = Symbol("sent");
function Reply(raw, state) {
  this.raw = raw;
  this[kState] = state;
  this[kSent] = false;
}
Object.defineProperty(Reply.prototype, "sent", {
  get() {
    return this[kSent];
  },
});
Reply.prototype.send = function (value) {
  this[kSent] = true;
  this.raw.push(value + this[kState]);
  return this;
};
module.exports = Reply;
