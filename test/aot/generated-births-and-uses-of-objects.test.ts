import { programs } from "./generated/births-and-uses/objects";
import { birthsAndUses } from "./generated/births-and-uses/run";

birthsAndUses("objects", programs(false));
