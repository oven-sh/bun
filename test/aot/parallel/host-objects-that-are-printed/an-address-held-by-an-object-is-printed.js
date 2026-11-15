// One question: built alone, it prints as plain Bun does.
const url = new URL("http://made.up/a"); setImmediate(() => {});
console.log({ held: url });
