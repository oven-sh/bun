import { platform } from "node:os";
import { p } from "@made-up/above";
export const all = () => p() + " " + platform();
