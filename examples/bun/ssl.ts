import { resolve } from "path";

const development = process.env.NODE_ENV !== "production";
export default {
  fetch(req: Request) {
    Bun.file;
    return new Response(Bun.file(resolve(req.url.substring(1))));
  },

  //   hostname: "0.0.0.0",
  //   port: parseInt(process.env.PORT || "443", 10),
  //   keyFile: process.env.SSL_KEY_FILE || "./key.pem",
  //   certFile: process.env.SSL_CERTIFICATE_FILE || "./cert.pem",
  development,
} as Bun.Serve;
