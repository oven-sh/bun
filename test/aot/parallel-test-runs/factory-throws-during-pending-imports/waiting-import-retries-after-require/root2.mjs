import { slow } from "./slow.mjs";
import { value } from "./mocked.mjs";
export const seen = () => slow + " | " + value;
