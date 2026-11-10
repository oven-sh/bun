import { value } from "./mocked.mjs";
import { slow } from "./slow.mjs";
export const seen = () => slow + " | " + value;
