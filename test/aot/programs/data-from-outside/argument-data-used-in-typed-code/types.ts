import { pass } from "./pass";
export interface Row {
  id: number;
  name: string;
}
export interface Line {
  id: number;
  name: string;
}
export function viaPass(row: Row): Line {
  return pass(row);
}
