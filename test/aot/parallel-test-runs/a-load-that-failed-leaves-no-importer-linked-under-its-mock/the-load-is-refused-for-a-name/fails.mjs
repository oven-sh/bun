import { look } from "./user.mjs";
import { nobodyExportsThis } from "./plain.mjs";
export const both = () => [look(), nobodyExportsThis];
