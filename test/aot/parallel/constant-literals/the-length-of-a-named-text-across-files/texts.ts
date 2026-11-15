export const FIRST = "the first text of the file";
export const SECOND = "the second";
export const lengths = FIRST.length + SECOND.length + process.argv.length - process.argv.length;
export function both() { return FIRST.length * 100 + SECOND.length; }
