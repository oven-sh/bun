import { programs } from "./generated/births-and-uses/classes-whose-parent-is-replaced";
import { birthsAndUses } from "./generated/births-and-uses/run";

birthsAndUses("classes whose parent is replaced", programs(), 3, 3);
