import { shared } from "./shared";

const atStart = shared;
export const read = () => atStart + " " + shared;
