import { vi } from "vitest";
vi.mock("./config.mjs", async importOriginal => ({ ...(await importOriginal()), config: () => "mocked config" }));
vi.mock("./model.mjs", async importOriginal => ({ ...(await importOriginal()), model: () => "mocked model" }));
vi.mock("./scope.mjs", async () => ({ ...(await vi.importActual("./scope.mjs")), scope: () => "mocked scope" }));
export const load = () => import("./other.mjs");
