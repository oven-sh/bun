let tail = [0];
const tricky = { *[Symbol.iterator]() { tail[0] = 10; tail.push(11); yield 3; } };
function join(first, start) { tail = [start, 2]; return JSON.stringify([...first, ...tail]) + JSON.stringify(Math.max(...first, ...tail)); }
for (const first of [[1], tricky, [1]]) console.log(join(first, 1));
