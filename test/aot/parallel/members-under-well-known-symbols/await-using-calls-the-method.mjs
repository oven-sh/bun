class Handle { async [Symbol.asyncDispose]() { console.log("disposed"); } read() { return 1; } idle() { return 2; } }
{ await using handle = new Handle(); console.log(handle.read()); }
console.log("behind");
