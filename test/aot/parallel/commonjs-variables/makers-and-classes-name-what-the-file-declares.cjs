"use strict";
const config = require("./lib-plain.cjs");
const kState = Symbol("state");
let made = 0;
function Request(id, params) { this.id = id; this.config = config; this.params = params; this[kState] = ++made; this.body = undefined; }
Request.prototype.state = function () { return this[kState]; };
class Reply { #sent = false; constructor(request) { this.request = request; this.order = made; } send() { this.#sent = true; return this.request.state() + ":" + this.order + ":" + this.#sent + ":" + (this.request.config === config); } }
const all = [];
for (let i = 0; i < 4; i++) all.push(new Reply(new Request(i, { i })).send());
console.log(all.join(" "), Object.keys(new Request(9, null)).join(), made);
