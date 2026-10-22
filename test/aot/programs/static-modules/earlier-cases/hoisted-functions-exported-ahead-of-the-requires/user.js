"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) { return (mod && mod.__esModule) ? mod : { "default": mod }; };
Object.defineProperty(exports, "__esModule", { value: true });
exports.viaConst = exports.viaVar = void 0;
exports.declared = declared;
var v = require("./lib");
const c = require("./lib");
var debug = require("./named")("user");
var boxed = __importDefault(require("./lib"));
function declared() { return v.K + c.K + boxed.default.K; }
exports.viaVar = function () { return v.K; };
exports.viaConst = function () { return c.K; };
exports.debug = debug;
