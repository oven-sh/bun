import { Weigh } from "./function";
function Weigh(load: number): number {
  return load * 2;
}
const typed: Weigh = Weigh;
export const answer = typed(3);
