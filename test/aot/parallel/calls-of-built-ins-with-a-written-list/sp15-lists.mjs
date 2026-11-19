const l = [3, 1, 2];
l.push(...[4]);
console.log(l.indexOf(...[1]), l.slice(...[1]).join(), l.includes(...[9]), l.join(...["-"]), l.at(...[0]), [...l].sort(...[(a, b) => a - b]).join());
export {};
