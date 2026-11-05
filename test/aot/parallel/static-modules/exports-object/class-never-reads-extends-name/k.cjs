"use strict";
var x = require("./x.cjs");
class OnlyMadeInUnread {
  constructor(settings) {
    this.settings = settings;
  }
}
class Unread extends x.OnlyExtendedHere {
  helper;
  constructor({ a }) {
    super({ a });
    this.helper = new OnlyMadeInUnread({ a });
  }
}
class Read extends x.Other {
  who() {
    return "read " + super.who();
  }
}
exports.OnlyMadeInUnread = OnlyMadeInUnread;
exports.Unread = Unread;
exports.Read = Read;
