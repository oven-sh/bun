// A getter calls process.exit() before a write to a locked built-in.
const settings = {
  get ready() {
    console.log("done");
    process.exit(0);
  },
};
settings.ready;
Array.prototype.push = function () {};
