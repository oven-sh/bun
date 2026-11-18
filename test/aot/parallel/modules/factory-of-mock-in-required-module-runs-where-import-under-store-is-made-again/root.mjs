import { name as first } from "./first.cjs";
import outside from "outside-package";
import { name as waits } from "./waits.cjs";
import { value } from "./later.mjs";
see("root");
export const name = "root over " + first + ", " + outside.label + ", " + waits + ", " + value;
