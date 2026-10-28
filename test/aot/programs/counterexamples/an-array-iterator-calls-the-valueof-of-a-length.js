// The length of the object that an array iterator goes over is an object. Only the iterator ever converts it.
const listLike = {
  length: {
    valueOf() {
      return 2;
    },
  },
  0: 1,
  1: 2,
};
console.log(JSON.stringify([...Array.prototype.values.call(listLike)]));
