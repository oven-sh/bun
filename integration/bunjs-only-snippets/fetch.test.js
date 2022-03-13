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

function testBlobInterface(blobbyConstructor, hasBlobFn) {
  it("json", async () => {
    var response = blobbyConstructor(JSON.stringify({ hello: true }));
    expect(JSON.stringify(await response.json())).toBe(
      JSON.stringify({ hello: true })
    );
  });
  it("text", async () => {
    var response = blobbyConstructor(JSON.stringify({ hello: true }));
    expect(await response.text()).toBe(JSON.stringify({ hello: true }));
  });
  it("arrayBuffer", async () => {
    var response = blobbyConstructor(JSON.stringify({ hello: true }));

    const bytes = new TextEncoder().encode(JSON.stringify({ hello: true }));
    const compare = new Uint8Array(await response.arrayBuffer());
    for (let i = 0; i < compare.length; i++) {
      expect(compare[i]).toBe(bytes[i]);
    }
  });
  hasBlobFn &&
    it("blob", async () => {
      var response = blobbyConstructor(JSON.stringify({ hello: true }));
      const size = JSON.stringify({ hello: true }).length;
      const blobed = await response.blob();
      expect(blobed instanceof Blob).toBe(true);
      expect(blobed.size).toBe(size);
      expect(blobed.type).toBe("");
      blobed.type = "application/json";
      expect(blobed.type).toBe("application/json");
    });
}

describe("Blob", () => {
  testBlobInterface((data) => new Blob([data]));

  var blobConstructorValues = [
    ["123", "456"],
    ["123", 456],
    ["123", "456", "789"],
    ["123", 456, 789],
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    [Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 9])],
    [Uint8Array.from([1, 2, 3, 4]), "5678", 9],
    [new Blob([Uint8Array.from([1, 2, 3, 4])]), "5678", 9],
  ];
  var expected = [
    "123456",
    "123456",
    "123456789",
    "123456789",
    "123456789",
    "\x01\x02\x03\x04\x05\x06\x07\t",
    "\x01\x02\x03\x0456789",
    "\x01\x02\x03\x0456789",
  ];

  it(`blobConstructorValues`, async () => {
    for (let i = 0; i < blobConstructorValues.length; i++) {
      var response = new Blob(blobConstructorValues[i]);
      const res = await response.text();
      if (res !== expected[i]) {
        throw new Error(
          `Failed: ${expected[i]
            .split("")
            .map((a) => a.charCodeAt(0))}, received: ${res
            .split("")
            .map((a) => a.charCodeAt(0))}`
        );
      }

      expect(res).toBe(expected[i]);
    }
  });
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
  testBlobInterface((data) => new Response(data), true);
});

describe("Request", () => {
  it("clone", async () => {
    var body = new Request("https://hello.com", {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      body: "<div>hello</div>",
    });
    expect(body.headers.get("content-type")).toBe("text/html; charset=utf-8");

    var clone = body.clone();
    body.headers.set("content-type", "text/plain");
    expect(clone.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(body.headers.get("content-type")).toBe("text/plain");
    expect(await clone.text()).toBe("<div>hello</div>");
  });

  testBlobInterface(
    (data) => new Request("https://hello.com", { body: data }),
    true
  );
});

describe("Headers", () => {
  it("writes", async () => {
    var body = new Request("https://hello.com", {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      body: "<div>hello</div>",
    });
    expect(body.headers.get("content-type")).toBe("text/html; charset=utf-8");

    var clone = body.clone();
    body.headers.set("content-type", "text/plain");
    expect(clone.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(body.headers.get("content-type")).toBe("text/plain");
    expect(await clone.text()).toBe("<div>hello</div>");
  });
});
