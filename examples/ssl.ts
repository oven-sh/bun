import { resolve } from "path";
import type { ServeOptions } from "bun";

const development = process.env.NODE_ENV !== "production";
export default {
  fetch(req: Request) {
    return new Response(Bun.file(resolve(req.url.substring(1))));
  },

  // hostname: "0.0.0.0",
  port: process.env.PORT || "443",
  keyFile: process.env.SSL_KEY_FILE || "./key.pem",
  certFile: process.env.SSL_CERTIFICATE_FILE || "./cert.pem",
  development,
} as ServeOptions;
