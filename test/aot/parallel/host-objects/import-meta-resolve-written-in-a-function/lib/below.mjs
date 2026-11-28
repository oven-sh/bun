export const askBelow = name => import.meta.resolve(name);
export const takeBelow = () => {
  const { resolve } = import.meta;
  return resolve;
};
