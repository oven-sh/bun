import other, { value as named } from "./lib.cjs";
export { named };
export const log = () => other.log;
other.log.push("user runs " + other.counter);
