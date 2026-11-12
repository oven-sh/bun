import { vi } from "vitest";
vi.mock("./scope.mjs", async () => ({ ...(await vi.importActual("./scope.mjs")), scope: () => "mocked scope" }));
export const load = () => import("./other.mjs");
