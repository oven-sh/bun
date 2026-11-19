"use strict";
const space = {};
Object.defineProperty(space, "__esModule", { value: true });
space.default = function greet(n) { return (n + 1) | 0; };
function pick(from) { return from && from.__esModule ? from : { default: from }; }
let said = 0; for (let turn = 0; turn < 3000; turn++) said = (said + pick(space).default(turn)) % 1000003;
console.log(said, Object.keys(space).join(), JSON.stringify(Object.getOwnPropertyDescriptor(space, "__esModule")), pick(7).default);
