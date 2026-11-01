const shared = { n: 0 };
Object.assign(Event.prototype, { get laid() { return shared; } });
new CustomEvent("x").laid.n = 7;
console.log(`${shared.n}`);
