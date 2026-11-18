import { name as first } from "./first.cjs";
import outside from "outside-package";
import { name as calls } from "./calls.cjs";
see("root");
export const name = "root over " + first + ", " + outside.label + ", " + calls;
