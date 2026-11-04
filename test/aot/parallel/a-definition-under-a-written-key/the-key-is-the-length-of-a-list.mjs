const l = [1, 2, 3];
function act() { Object.defineProperty(l, "length", { value: 1 }); }
act();
console.log(l.length, typeof l[1], l.join());
