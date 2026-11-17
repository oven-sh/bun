import { value as inner } from "./dep.cjs";
export const value = () => "mid " + inner();
