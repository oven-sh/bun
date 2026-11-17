switch (process.argv.length > 99 ? 1 : 2) {
  case 1:
    var module = 1;
  case 2:
    exports.kind = typeof module;
}
