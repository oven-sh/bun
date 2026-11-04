const record = { from: 2, to: 5, *[Symbol.iterator]() { for (let i = this.from; i < this.to; i++) yield i; } };
console.log([...record].join(), Math.min(...record));
const lacking = { from: 1 };
try { console.log([...(lacking as any)].length); } catch (error) { console.log(String(error)); }
const wrong = { [Symbol.iterator]() { return 5; } };
try { console.log([...(wrong as any)].length); } catch (error) { console.log(String(error)); }
