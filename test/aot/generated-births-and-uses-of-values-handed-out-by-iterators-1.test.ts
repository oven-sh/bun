import { birthsAndUses } from "./generated/births-and-uses/run";
import { programs } from "./generated/births-and-uses/values-handed-out-by-iterators";

birthsAndUses("values handed out by iterators", programs(), 1, 3);
