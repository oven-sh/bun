function inLoop(start) { let count = start; return () => ++count; }
const others = [];
for (let turn = 0; turn < 2; turn++) others.push(inLoop(turn * 100));
console.log(others[0](), others[1](), others[0]());
