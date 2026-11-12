import * as own from "./every-method-that-a-stub-answers-takes-the-sum.mjs";
export var width = 2;
function a(text, at) { return text.slice(at); }
function b(text, at) { return text.substring(1, at); }
function c(text, at) { return text.substr(at, 2); }
function d(text, at) { return text.indexOf("c", at); }
function e(text, at) { return text.charCodeAt(at); }
function f(text, at) { return text.at(at); }
function g(text, at) { return text.lastIndexOf("a", at); }
function h(text, at) { return text.padStart(at, "-"); }
function i(list, at) { return list.slice(at); }
function j(list, at) { return list.indexOf(3, at); }
export function all(text, list) { return [a(text, width + 1), b(text, width + 1), c(text, width - 1), d(text, width * 1), e(text, width + 1), f(text, width - 3), g(text, width + 1), h(text, width + 4), i(list, width - 1), j(list, width - 2)]; }
export function one(text) { return a(text, width + 1); }
export function two(text) { return b(text, width - 0.5); }
export function three(list) { return i(list, width + 1); }
console.log(JSON.stringify(all("abcabc", [1, 2, 3, 4])), one("abcabc"), two("abcabc"), JSON.stringify(three([1, 2, 3, 4])), Object.keys(own).length);
