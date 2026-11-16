function Reply() { this.flag = 1; }
Object.defineProperties(Reply.prototype, { sent: { get() { return this.flag; } } });
const halves = Object.entries(Object.getOwnPropertyDescriptors(Reply.prototype)).map(([name, found]) => [name, found.get]);
for (const [name, half] of halves)
    console.log(name, half ? half.call({ flag: 12 }) : "none");
