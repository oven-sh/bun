const shelf = require("./shelf.cjs");
export const peek = () => {
  let found = 0;
  for (let i = 0; i < 300; i++) if (shelf.extra === "from above") found++;
  return found;
};
