// An iterator's next() calls process.exit() in a for-of loop before a write to a locked built-in.
const iterable = {
  [Symbol.iterator]() {
    return {
      next() {
        console.log("done");
        process.exit(0);
      },
    };
  },
};
for (const item of iterable);
Array.prototype.push = function () {};
