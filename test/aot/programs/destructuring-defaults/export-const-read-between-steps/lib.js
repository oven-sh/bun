import { first, second } from "./main.js";
import * as main from "./main.js";

const attempt = (get) => {
  try {
    return String(get());
  } catch (error) {
    return error.name;
  }
};

export const read = () => [attempt(() => first), attempt(() => second), attempt(() => main.first), attempt(() => main.second)].join(" ");
