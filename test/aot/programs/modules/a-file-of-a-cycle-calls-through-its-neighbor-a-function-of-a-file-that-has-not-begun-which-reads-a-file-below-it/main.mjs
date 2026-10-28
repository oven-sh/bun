// first.mjs imports second.mjs and then third.mjs; second.mjs imports first.mjs and calls a function of it that reads third.mjs, and one that calls a function of third.mjs that reads fourth.mjs:
// neither of the two has begun. A second import() comes to fourth.mjs by another way.
setTimeout(() => {
  import("./first.mjs").then(all => console.log("first loaded", all.readThird(), all.readFourth()));
}, 1);
console.log("main ends");
