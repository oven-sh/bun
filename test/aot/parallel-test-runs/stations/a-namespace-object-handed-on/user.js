import { hand } from "./reader.js";

const said = read => {
  try {
    const value = read();
    return typeof value === "function" ? value() : String(value);
  } catch {
    return "threw";
  }
};

export const readOffHandedOn = () => [hand().fn(), String(hand().added)].join();
export const readByPattern = () => {
  const { fn, added } = hand();
  return [fn(), String(added)].join();
};
export const readByKey = key => said(() => hand()[key]);
export function readInLoop() {
  const held = hand();
  let seen = "";
  for (let i = 0; i < 300; i++) seen = held.fn() + "," + hand().fn();
  return seen;
}
