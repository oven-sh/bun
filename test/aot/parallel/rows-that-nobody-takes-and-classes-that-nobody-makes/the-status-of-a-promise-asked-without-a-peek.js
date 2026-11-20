const settled = Promise.resolve(7);
console.log(Bun.peek.status(settled), Bun.peek(settled), typeof Bun.peek);
