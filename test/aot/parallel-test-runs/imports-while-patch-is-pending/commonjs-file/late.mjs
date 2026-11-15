import { value } from "./dep.cjs";
export const read = () => "late " + value();
