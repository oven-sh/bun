const { createHash } = require("crypto");

const hash = createHash("sha256");

hash.on("readable", () => {
  // Only one element is going to be produced by the
  // hash stream.
  const data = hash.read();
  if (data) {
    console.log(data.toString("hex"));
    // Prints:
    //   6a2da20943931e9834fc12cfe5bb47bbd9ae43489a30726962b576f4e3993e50
  }
});

hash.write("some data to hash");
console.log(hash._events);
debugger;
hash.end();
console.log(hash._events);
