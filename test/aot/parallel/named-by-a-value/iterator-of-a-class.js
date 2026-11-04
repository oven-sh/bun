class Steps { n = 0; next() { return { done: this.n++ > 1, value: this.n }; } return() { console.log("closed"); return {}; } [Symbol.iterator]() { return this; } }
for (const step of new Steps()) { console.log(step); break; }
