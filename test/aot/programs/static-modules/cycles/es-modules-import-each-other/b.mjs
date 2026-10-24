import { hoisted, constant, variable } from "./a.mjs";
const attempt = read => {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
};
export const seen = [attempt(() => hoisted()), attempt(() => constant), attempt(() => variable)].join();
export const readLater = () => [hoisted(), constant, variable].join();
