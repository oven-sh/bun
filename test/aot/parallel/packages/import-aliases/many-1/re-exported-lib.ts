import { tools } from "kit";
export import add = tools.add;
export import level = tools.level;
export import Counter = tools.Counter;
export import tools2 = tools;
export function raised() { tools.raise(); return tools.level + ":" + level; }
