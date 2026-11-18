import { name as first } from "./first.cjs";
import outside from "outside-package";
import { name as waits } from "./waits.cjs";
see("root");
export const name = "root over " + first + ", " + outside.label + ", " + waits;
