function* upTo(limit) { for (let i = 0; i < limit; i++) yield i; }
console.log([...upTo(3)].join());
let turns = 0;
upTo.prototype.next = function () { return turns++ < 2 ? { done: false, value: "of the prototype " + turns } : { done: true }; };
console.log([...upTo(3)].join());
delete upTo.prototype.next;
console.log([...upTo(3)].join());
