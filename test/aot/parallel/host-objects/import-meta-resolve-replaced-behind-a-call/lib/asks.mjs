export const ask = name => import.meta.resolve(name);
export const replace = () => {
  import.meta.resolve = () => "replaced";
};
