const inner = () => {
  if (globalThis.skip) return;
};
inner();
module.exports = function () {};
