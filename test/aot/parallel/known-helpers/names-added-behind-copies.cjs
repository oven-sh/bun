"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
const out = [];
const tell = (f) => { try { out.push(String(f())); } catch (error) { out.push(error.constructor.name); } };
var quiet = {};
__export(quiet, { a: () => 1, b: () => out.length });
var copy = __toCommonJS(quiet);
tell(() => { quiet.c = 3; return [Object.keys(copy), Object.keys(quiet), copy.c]; });
tell(() => { quiet.a = 5; });
tell(() => Object.defineProperty(quiet, "a", { get: () => 7 }));
tell(() => { delete quiet.a; });
tell(() => [copy.a, copy.b, Object.freeze(quiet).a, Object.setPrototypeOf(copy, { d: 4 }).d]);
var late = {};
__export(late, { a: () => 1 });
fill();
var copyOfLate = __toCommonJS(late);
function fill() { late.b = 2; }
tell(() => Object.keys(copyOfLate));
fillEarly();
var early = {};
__export(early, { a: () => 1 });
var copyOfEarly = __toCommonJS(early);
function fillEarly() { tell(() => { early.b = 2; }); }
tell(() => Object.keys(copyOfEarly));
var between = {};
__export(between, { a: () => 1 });
var other = { get x() { between.y = 1; return 1; } }.x;
var copyOfBetween = __toCommonJS(between);
tell(() => Object.keys(copyOfBetween));
var inside = {};
__export(inside, { a: () => 1 });
var copyInside = __toCommonJS((inside.z = 1, inside));
tell(() => Object.keys(copyInside));
console.log(out.join("\n"));
