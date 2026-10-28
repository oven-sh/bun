import { column } from "./tables.js";
const nothing = /low|high/g;
export const prices = column("prices", nothing);
export const neverCalled = () => nothing;
