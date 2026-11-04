import { say, who } from "./lib";

const held = say;
export const read = () => who + " " + say();
export const readHeld = () => held();
