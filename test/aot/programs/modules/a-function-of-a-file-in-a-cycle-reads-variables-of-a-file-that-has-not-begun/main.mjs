// first.mjs imports second.mjs and then third.mjs; second.mjs imports first.mjs and calls functions of it that read third.mjs, whose code has not begun.
setTimeout(() => {
  import("./first.mjs").then(all =>
    console.log("first loaded", all.readVar(), all.readFraction(), all.readLet(), all.readStatic()),
  );
}, 1);
console.log("main ends");
