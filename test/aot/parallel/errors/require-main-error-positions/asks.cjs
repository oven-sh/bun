const at = run => {
  try {
    return String(run());
  } catch (error) {
    const frame = String(error.stack)
      .split("\n")
      .find(line => /^\s+at /.test(line));
    return error.name + " " + frame.trim().replace(/\(?[^\s(]*[\\/]([^\\/\s:]+:\d+:\d+)\)?/, "$1");
  }
};
const holder = { main: undefined };
console.log("require.main", typeof require.main);
console.log(at(() => require.main.exports));
console.log(at(() => holder.main.exports));
console.log(at(() => [1, require.main.exports]));
console.log(at(() => [1, holder.main.exports]));
console.log(at(() => require.main.exports.deep));
console.log(at(() => holder.main.exports.deep));
console.log(at(() => require.main["exports"]));
console.log(at(() => holder.main["exports"]));
console.log(at(() => (require.main.exports = 1)));
console.log(at(() => (holder.main.exports = 1)));
console.log(at(() => require.main.exports()));
console.log(at(() => holder.main.exports()));
console.log(at(() => delete require.main.exports));
console.log(at(() => delete holder.main.exports));
console.log(at(() => require.main.exports++));
console.log(at(() => holder.main.exports++));
console.log(at(() => "exports" in require.main));
console.log(at(() => "exports" in holder.main));
console.log(at(() => new require.main.exports()));
console.log(at(() => new holder.main.exports()));
console.log(at(() => require.main()));
console.log(at(() => holder.main()));
// prettier-ignore
console.log(at(() => require . main . exports));
// prettier-ignore
console.log(at(() =>
  require
    .main
    .exports));
console.log(at(() => require.main?.exports));
// prettier-ignore
console.log(at(() => (require.main).exports));
function shadowed(require) {
  return at(() => require.main.exports);
}
console.log(shadowed({ main: undefined }));
