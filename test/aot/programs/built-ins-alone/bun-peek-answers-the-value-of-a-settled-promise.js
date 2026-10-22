const promise = Promise.resolve({ size: 1.5 });
console.log(Bun.peek(promise).size + 1, Bun.peek(2.5) + 1, Bun.peek(new Promise(() => {})) instanceof Promise);
