import { birthsAndUses } from "./generated/births-and-uses/run";
import { programs } from "./generated/births-and-uses/stores-of-two-takers-of-one-source";

birthsAndUses("stores of two takers of one source", programs(), 2, 5);
