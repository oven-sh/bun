import { open, size } from "./valve.mjs";
export const pump = () => open() + "/" + size;
export const held = () => open;
