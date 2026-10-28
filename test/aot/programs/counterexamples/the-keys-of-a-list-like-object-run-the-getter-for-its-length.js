// The length that an array iterator asks for stands behind a getter that nothing else runs: on the object, above it, and on an object whose own iterator is Array.prototype.keys.
function upTo(count) {
  return [
    ...Array.prototype.keys.call({
      get length() {
        return count;
      },
    }),
  ];
}
const inherited = count => [
  ...Array.prototype.keys.call({
    __proto__: {
      get length() {
        return count;
      },
    },
  }),
];
const walked = count => [
  ...{
    get length() {
      return count;
    },
    [Symbol.iterator]: Array.prototype.keys,
  },
];
console.log(JSON.stringify([upTo(3), upTo(process.argv.length), inherited(2), walked(1)]));
