interface Options { depth: number }
const literal: Options = { depth: 2 };
let chosen: Options | undefined;
function depth(): number { return chosen ? chosen.depth : -1; }
console.log(depth());
chosen = Object.create({ depth: 9 }) as Options;
console.log(depth(), literal.depth);
chosen = undefined;
console.log(depth());
