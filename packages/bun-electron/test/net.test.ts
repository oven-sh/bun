// Ported from Electron's spec/api-net-spec.ts (request/response subset),
// exercised against a local Bun server.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { net } from "../src/index.ts";

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/echo") {
        const body = await req.text();
        return new Response(body, { headers: { "x-method": req.method } });
      }
      if (url.pathname === "/json") {
        return Response.json({ ok: true, n: 7 });
      }
      if (url.pathname === "/status") {
        return new Response("teapot", { status: 418 });
      }
      return new Response("hello");
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

describe("net module", () => {
  describe("net.fetch", () => {
    test("performs a GET and returns a Response", async () => {
      const res = await net.fetch(`${base}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello");
    });

    test("parses JSON responses", async () => {
      const res = await net.fetch(`${base}/json`);
      expect(await res.json()).toEqual({ ok: true, n: 7 });
    });
  });

  describe("net.request", () => {
    test("emits a response event with statusCode and headers", async () => {
      const result = await new Promise<{ status: number; body: string; method: string }>((resolve, reject) => {
        const request = net.request(`${base}/`);
        request.on("response", (response) => {
          let body = "";
          response.on("data", (chunk: Buffer) => (body += chunk.toString()));
          response.on("end", () =>
            resolve({ status: response.statusCode, body, method: response.headers["x-method"] ?? "" }),
          );
        });
        request.on("error", reject);
        request.end();
      });
      expect(result.status).toBe(200);
      expect(result.body).toBe("hello");
    });

    test("sends a POST body via write/end", async () => {
      const body = await new Promise<string>((resolve, reject) => {
        const request = net.request({ method: "POST", url: `${base}/echo` });
        request.setHeader("content-type", "text/plain");
        request.on("response", (response) => {
          expect(response.headers["x-method"]).toBe("POST");
          let data = "";
          response.on("data", (chunk: Buffer) => (data += chunk.toString()));
          response.on("end", () => resolve(data));
        });
        request.on("error", reject);
        request.write("part1 ");
        request.end("part2");
      });
      expect(body).toBe("part1 part2");
    });

    test("surfaces non-2xx status codes", async () => {
      const status = await new Promise<number>((resolve, reject) => {
        const request = net.request(`${base}/status`);
        request.on("response", (response) => {
          response.on("end", () => resolve(response.statusCode));
          response.on("data", () => {});
        });
        request.on("error", reject);
        request.end();
      });
      expect(status).toBe(418);
    });

    test("emits error for an unreachable host", async () => {
      const free = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
      const port = free.port;
      free.stop(true);
      await expect(
        new Promise((resolve, reject) => {
          const request = net.request(`http://127.0.0.1:${port}/`);
          request.on("response", resolve);
          request.on("error", reject);
          request.end();
        }),
      ).rejects.toBeDefined();
    });
  });
});
