// Object.assign runs the getters of its sources before it stores, also for a name that the prototype refuses.
class Reads {
  get x() {
    return 1;
  }
}
class Counts {
  get n() {
    return 1;
  }
}
try {
  Object.assign(Reads.prototype, {
    get x() {
      throw new URIError("x");
    },
  });
} catch (error) {
  console.log("thrown by the source", error.name, error.message);
}

let reads = 0;
const source = {
  get n() {
    return ++reads;
  },
};
try {
  Object.assign(Counts.prototype, source);
} catch (error) {
  console.log("refused by the target", error.name, reads);
}
console.log(new Reads().x, new Counts().n);
