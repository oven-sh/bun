"use strict";
const words = { en: "hello" }; let aliased, now = "en";
exports.define = (k, w) => { words[k] = w; };
exports.locale = k => { if (!words[k]) { try { aliased = require; aliased("./locale/" + k); } catch (e) {} } if (words[k]) now = k; return now; };
exports.say = () => words[now];
