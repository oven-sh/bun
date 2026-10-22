// A listener in a third module requires modules while their bodies run: a literal, a getter, a star, a redirect, a hoisted function, a late marker. No cycle in the graph.
require("./x"); require("./listener");
const lit = require("./lit"), get = require("./get"), star = require("./star"), of = require("./of"), prologue = require("./prologue");
console.log(lit.seen, lit.l, "|", get.seen, get.g, "|", star.seen, star.g, "|", of.seen, of.g, "|", prologue.seen, prologue.f());
console.log(require("./latemark").seen, require("./registry").emit("latemark again"));
