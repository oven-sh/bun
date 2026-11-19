const found = Object.keys(import.meta.glob("./*.word"));
export const label = "as built " + found.length;
