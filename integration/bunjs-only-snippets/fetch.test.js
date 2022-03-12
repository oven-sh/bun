import { it, describe, expect } from "bun:test";
import fs from "fs";

describe("fetch", () => {
  const urls = ["https://example.com", "http://example.com"];
  for (let url of urls) {
    it(url, async () => {
      const response = await fetch(url);
      const text = await response.text();

      if (
        fs.readFileSync(
          import.meta.path.substring(0, import.meta.path.lastIndexOf("/")) +
            "/fetch.js.txt",
          "utf8"
        ) !== text
      ) {
        throw new Error("Expected fetch.js.txt to match snapshot");
      }
    });
  }
});

describe("Response", () => {
  it("clone", async () => {
    var body = new Response("<div>hello</div>", {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
    var clone = body.clone();
    body.headers.set("content-type", "text/plain");
    expect(clone.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(body.headers.get("content-type")).toBe("text/plain");
    expect(await clone.text()).toBe("<div>hello</div>");
  });
});
