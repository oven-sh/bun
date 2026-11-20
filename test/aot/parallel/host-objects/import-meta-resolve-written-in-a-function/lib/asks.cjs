exports.ask = name => import.meta.resolve(name);
exports.take = () => {
  const { resolve } = import.meta;
  return resolve;
};
