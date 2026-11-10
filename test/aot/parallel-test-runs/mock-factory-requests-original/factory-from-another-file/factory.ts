import { vi } from "bun:test";
export const factory = async () => {
  globalThis.ran = (globalThis.ran ?? "") + "factory,";
  return { ...(await vi.importActual("./own")), value: "mock" };
};
