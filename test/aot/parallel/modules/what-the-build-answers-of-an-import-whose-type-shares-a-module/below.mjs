import held from "./depth.json" with { type: "text" };
export const kindOfHeld = typeof held;
export const isHeldText = typeof held === "string";
export { held };
