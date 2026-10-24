import { first, renamed } from "./main.js";

const attempt = (get) => {
  try {
    return String(get());
  } catch (error) {
    return error.name;
  }
};

export const read = () => attempt(() => first) + " " + attempt(() => renamed);
