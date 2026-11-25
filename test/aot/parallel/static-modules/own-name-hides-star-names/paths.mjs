export * from "node:path";
export const join = (...parts) => "joined:" + parts.join("+");
