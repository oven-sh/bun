import node from "@astrojs/node";
import { defineConfig } from "astro/config";

export default defineConfig({ output: "server", adapter: node({ mode: "standalone" }), security: { checkOrigin: false } });
