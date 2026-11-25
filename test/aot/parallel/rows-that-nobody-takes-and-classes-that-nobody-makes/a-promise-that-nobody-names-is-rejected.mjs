// Exit code: 1
async function fails() { throw new Error("nobody hears it"); }
fails();
console.log("went on");
