import { name as first } from "./first.cjs";
import outside from "outside-package";
import { name as drains } from "./drains.cjs";
see("root");
export const name = "root over " + first + ", " + outside.label + ", " + drains;
