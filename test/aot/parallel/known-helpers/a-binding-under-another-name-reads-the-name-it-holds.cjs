// `__createBinding(o, m, "from", "to")`: the getter that is found under `to` holds `from`.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var source = { first: 1, second: 20, third: 300 };
var crossed = {};
__createBinding(crossed, source, "first", "second");
__createBinding(crossed, source, "second", "first");
__createBinding(crossed, source, "third");
function turn(i) { return crossed.first + crossed.second * 2 + crossed.third * 3 + i; }
var sum = 0;
for (var i = 0; i < 1000; i++) sum += turn(i & 7);
console.log(sum, crossed.first, crossed.second, crossed.third, Object.keys(crossed).join());
source.first = 5;
console.log(crossed.first, crossed.second, turn(0));
