import { kinds } from "./barrel";
export function reads() {
  return [kinds.InMap.One, kinds.InSet.One, kinds.InList["One"], kinds.OnlyRead.One, kinds.InMap.Two, kinds.InList["Two"]].join();
}
