const { status } = Bun.peek;
console.log(status(Promise.resolve(1)));
