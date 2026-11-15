"use strict";
const n = process.argv.length, log = [];
const made = (source, flags) => new RegExp(source.replaceAll("#", String(n)), flags);
const show = found => found === null ? "null" : JSON.stringify([...found]) + "@" + found.index + (found.groups ? JSON.stringify(found.groups) : "") + (found.indices ? JSON.stringify(found.indices) : "");
const many = made(Array.from({ length: 14 + n }, (_, i) => "(" + String.fromCharCode(97 + i) + ")").join("")); log.push(show(many.exec("abcdefghijklmnopqrstuvwxyz")), show(many.exec("abc")));
const fifteen = made(Array.from({ length: 13 + n }, (_, i) => "(" + String.fromCharCode(97 + i) + ")?").join("")); log.push(show(fifteen.exec("abcdefghijklmnopqrstuvwxyz")), show(fifteen.exec("zzz")));
console.log("SAID", log.join(" | "));
