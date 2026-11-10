const loaders = {
  small: () => import("./small.mjs"),
  large: () => import("./large.mjs"),
};
for (const name of ["large", "small"]) {
  const { size } = await loaders[name]();
  console.log(name, size);
}
