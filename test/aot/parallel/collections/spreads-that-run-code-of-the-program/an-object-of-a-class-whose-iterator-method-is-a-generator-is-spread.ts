class Walk { constructor(public limit: number) {} *[Symbol.iterator]() { for (let i = 0; i < this.limit; i++) yield i * 2; } }
console.log([...new Walk(4)].join(), Math.max(...new Walk(5)), [...new Walk(0)].length);
