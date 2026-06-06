// Ported from Electron's spec/api-session-spec.ts (ses.cookies subset).

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { session } from "../src/index.ts";
import { ensureReady } from "./harness.ts";

const url = "https://cookie-tests.bun-electron.test";
const cookies = session.defaultSession.cookies;

beforeAll(async () => {
  await ensureReady();
});

afterEach(async () => {
  for (const cookie of await cookies.get({ url })) {
    await cookies.remove(url, cookie.name);
  }
});

describe("session module", () => {
  describe("ses.cookies", () => {
    test("should set cookies", async () => {
      await cookies.set({ url, name: "1", value: "1" });
      const list = await cookies.get({ url });
      expect(list.some((c) => c.name === "1" && c.value === "1")).toBe(true);
    });

    test("should get cookies with the name filter", async () => {
      await cookies.set({ url, name: "alpha", value: "a" });
      await cookies.set({ url, name: "beta", value: "b" });
      const list = await cookies.get({ url, name: "alpha" });
      expect(list.length).toBe(1);
      expect(list[0].value).toBe("a");
    });

    test("should remove cookies", async () => {
      await cookies.set({ url, name: "gone", value: "soon" });
      await cookies.remove(url, "gone");
      const list = await cookies.get({ url, name: "gone" });
      expect(list.length).toBe(0);
    });

    test("set() rejects without a url", async () => {
      await expect(cookies.set({ name: "x", value: "y" } as never)).rejects.toThrow(/url/);
    });
  });

  describe("partitioned sessions", () => {
    test("fromPartition returns a stable, distinct session", () => {
      const a = session.fromPartition("persist:a");
      const b = session.fromPartition("persist:b");
      expect(a).toBe(session.fromPartition("persist:a"));
      expect(a).not.toBe(b);
      expect(a).not.toBe(session.defaultSession);
    });

    test("cookies are isolated between partitions", async () => {
      const purl = "https://partition-tests.bun-electron.test";
      const a = session.fromPartition("persist:cookies-a");
      const b = session.fromPartition("persist:cookies-b");
      await a.cookies.set({ url: purl, name: "k", value: "in-a" });
      const fromA = await a.cookies.get({ url: purl, name: "k" });
      const fromB = await b.cookies.get({ url: purl, name: "k" });
      expect(fromA.map((c) => c.value)).toEqual(["in-a"]);
      expect(fromB.length).toBe(0);
      await a.cookies.remove(purl, "k");
    });

    test("each session exposes cookies and webRequest", () => {
      const s = session.fromPartition("persist:shape");
      expect(s.cookies).toBeDefined();
      expect(s.webRequest).toBeDefined();
    });
  });
});
