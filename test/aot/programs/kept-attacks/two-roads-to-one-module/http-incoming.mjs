// Two roads to one module: http incoming. It prints what plain Bun prints.
import * as space from "node:_http_incoming";
import whole from "node:_http_incoming";
import { IncomingMessage as named_IncomingMessage, kReqShouldKeepAlive as named_kReqShouldKeepAlive, readStart as named_readStart, readStop as named_readStop } from "node:_http_incoming";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:_http_incoming");
const asked = process.getBuiltinModule("node:_http_incoming");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("IncomingMessage", named_IncomingMessage === space.IncomingMessage, named_IncomingMessage === whole.IncomingMessage, named_IncomingMessage === required.IncomingMessage, named_IncomingMessage === asked.IncomingMessage, space.IncomingMessage === required.IncomingMessage, whole.IncomingMessage === required.IncomingMessage, asked.IncomingMessage === required.IncomingMessage, whole.IncomingMessage === space.IncomingMessage);
same("kReqShouldKeepAlive", named_kReqShouldKeepAlive === space.kReqShouldKeepAlive, named_kReqShouldKeepAlive === whole.kReqShouldKeepAlive, named_kReqShouldKeepAlive === required.kReqShouldKeepAlive, named_kReqShouldKeepAlive === asked.kReqShouldKeepAlive, space.kReqShouldKeepAlive === required.kReqShouldKeepAlive, whole.kReqShouldKeepAlive === required.kReqShouldKeepAlive, asked.kReqShouldKeepAlive === required.kReqShouldKeepAlive, whole.kReqShouldKeepAlive === space.kReqShouldKeepAlive);
same("readStart", named_readStart === space.readStart, named_readStart === whole.readStart, named_readStart === required.readStart, named_readStart === asked.readStart, space.readStart === required.readStart, whole.readStart === required.readStart, asked.readStart === required.readStart, whole.readStart === space.readStart);
same("readStop", named_readStop === space.readStop, named_readStop === whole.readStop, named_readStop === required.readStop, named_readStop === asked.readStop, space.readStop === required.readStop, whole.readStop === required.readStop, asked.readStop === required.readStop, whole.readStop === space.readStop);
