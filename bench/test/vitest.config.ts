import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/suite/**/*.test.ts", "app/tests/**/*.test.ts"],
  },
});
