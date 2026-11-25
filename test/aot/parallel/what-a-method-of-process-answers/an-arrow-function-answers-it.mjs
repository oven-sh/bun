// An arrow function without braces answers what process.off() answers, and a list keeps it.
const kept = ["madeUp", "madeUpToo"].map(event => process.off(event, () => {}));
console.log(kept.length, kept[1] === process, typeof kept[0].allowedNodeEnvironmentFlags.has);
