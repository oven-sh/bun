"use strict";
function show(x) { console.log(x); }
show("first");
const kept = JSON.parse("[]");
kept.push(new Response("a"));
kept[0] = kept[0].body;
kept.forEach(show);
console.log("SAID");
