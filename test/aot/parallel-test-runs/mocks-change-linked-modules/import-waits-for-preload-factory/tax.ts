import { region } from "./region";
export const rate = region === "EU" ? 0.2 : 0.1;
export let label = "real " + region;
export class Tax {}
export function round() { return "real"; }
