exports.me = module;
exports.call = () => "called in other";
exports.store = path => {
  Bun.main = path;
};
exports.identity = value => [value, 1].find(it => typeof it === "object");
