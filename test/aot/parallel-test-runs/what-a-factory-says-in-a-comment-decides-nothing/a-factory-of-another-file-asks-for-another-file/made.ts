import { vi } from "bun:test";
export const made = async () => {
  await vi.importActual("./other");
  return { value: "mock" };
};
