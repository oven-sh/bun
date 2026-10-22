import { programs } from "./generated/births-and-uses/callables";
import { birthsAndUses } from "./generated/births-and-uses/run";

birthsAndUses("callables", programs(false));
