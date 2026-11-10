if (process.argv.length > 99) {
  var uses = {
    path(found) {
      return typeof found.join;
    },
  };
} else {
  var uses = {
    zlib(found) {
      return typeof found.gzipSync;
    },
  };
}
for (const name in uses) console.log("SAID", name, uses[name](require(name)));
