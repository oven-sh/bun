"use strict";
// STATISTIC: AnswersOfLookupsAskedForNumbers >= 4
// STATISTIC: LookupsBuiltInFrontOfLoops >= 4
const turns = JSON.parse("8") | 0;
// One of the four is a text: the sum is a text from there on, in the order in which it is written.
const settings = new Map(Object.entries(JSON.parse("{\"port\":8080,\"body\":\"b\",\"ttl\":60,\"depth\":3}")));
function sum(t) { let s = 0; for (let i = 0; i < turns; i++) s += settings.get("port") + settings.get("body") + settings.get("ttl") + settings.get("depth") + t; return s; }
const out = []; for (let t = 0; t < 3; t++) out.push(sum(t)); console.log(out.join("|"));
