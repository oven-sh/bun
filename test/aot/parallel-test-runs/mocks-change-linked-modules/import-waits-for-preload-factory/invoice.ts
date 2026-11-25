import { rate, label, round, Tax } from "./tax";
export const read = () => [rate, label, round(), Tax.name];
