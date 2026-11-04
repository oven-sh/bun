import { vi } from "bun:test";
export const load = () => vi.importActual("./dep.js");
