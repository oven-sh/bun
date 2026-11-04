let loaded = 0;
let awaited = 0;
let wake = () => {};
exports.loaded = name => () => {
  console.log(name, "is loaded");
  loaded++;
  wake();
};
exports.until = async count => {
  awaited += count;
  while (loaded < awaited) await new Promise(resolve => (wake = resolve));
};
