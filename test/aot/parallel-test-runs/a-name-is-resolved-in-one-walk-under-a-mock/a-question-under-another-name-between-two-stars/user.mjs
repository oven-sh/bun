import * as all from "./a.mjs";
export const look = () =>
  Object.keys(all).sort().join() +
  " " +
  String(all.curved) +
  " " +
  String(all.round) +
  " " +
  String(Reflect.get(all, "curved")) +
  " " +
  String(all.square);
