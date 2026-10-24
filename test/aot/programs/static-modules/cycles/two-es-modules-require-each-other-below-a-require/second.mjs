const first = require("./first.mjs");
const attempt = read => {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
};
export const saw = [attempt(() => Object.keys(first).join()), attempt(() => first.name), attempt(() => first.hoisted())].join("|");
export const later = () => [Object.keys(first).join(), first.name].join("|");
