// One question: built alone, it prints as plain Bun does.
const url = new URL("http://made.up/a"); setImmediate(() => {});
class Mine extends URL {} console.log(new Mine("http://made.up/b"));
