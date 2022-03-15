import { it, describe, expect } from "bun:test";
import fs from "fs";

function gc() {
  // console.trace();
  Bun.gc(true);
}

describe("fetch", () => {
  const urls = ["https://example.com", "http://example.com"];
  for (let url of urls) {
    gc();
    it(url, async () => {
      gc();
      const response = await fetch(url);
      gc();
      const text = await response.text();
      gc();
      expect(
        fs.readFileSync(
          import.meta.path.substring(0, import.meta.path.lastIndexOf("/")) +
            "/fetch.js.txt",
          "utf8"
        )
      ).toBe(text);
    });
  }
});

function testBlobInterface(blobbyConstructor, hasBlobFn) {
  for (let withGC of [false, true]) {
    it(`json${withGC ? " (with gc) " : ""}`, async () => {
      if (withGC) gc();
      var response = blobbyConstructor(JSON.stringify({ hello: true }));
      if (withGC) gc();
      expect(JSON.stringify(await response.json())).toBe(
        JSON.stringify({ hello: true })
      );
      if (withGC) gc();
    });

    it(`arrayBuffer -> json${withGC ? " (with gc) " : ""}`, async () => {
      if (withGC) gc();
      var response = blobbyConstructor(
        new TextEncoder().encode(JSON.stringify({ hello: true }))
      );
      if (withGC) gc();
      expect(JSON.stringify(await response.json())).toBe(
        JSON.stringify({ hello: true })
      );
      if (withGC) gc();
    });

    it(`text${withGC ? " (with gc) " : ""}`, async () => {
      if (withGC) gc();
      var response = blobbyConstructor(JSON.stringify({ hello: true }));
      if (withGC) gc();
      expect(await response.text()).toBe(JSON.stringify({ hello: true }));
      if (withGC) gc();
    });

    it(`arrayBuffer -> text${withGC ? " (with gc) " : ""}`, async () => {
      if (withGC) gc();
      var response = blobbyConstructor(
        new TextEncoder().encode(JSON.stringify({ hello: true }))
      );
      if (withGC) gc();
      expect(await response.text()).toBe(JSON.stringify({ hello: true }));
      if (withGC) gc();
    });

    it(`arrayBuffer${withGC ? " (with gc) " : ""}`, async () => {
      if (withGC) gc();

      var response = blobbyConstructor(JSON.stringify({ hello: true }));
      if (withGC) gc();

      const bytes = new TextEncoder().encode(JSON.stringify({ hello: true }));
      if (withGC) gc();

      const compare = new Uint8Array(await response.arrayBuffer());
      if (withGC) gc();

      for (let i = 0; i < compare.length; i++) {
        if (withGC) gc();

        expect(compare[i]).toBe(bytes[i]);
        if (withGC) gc();
      }
      if (withGC) gc();
    });

    it(`arrayBuffer -> arrayBuffer${withGC ? " (with gc) " : ""}`, async () => {
      if (withGC) gc();

      var response = blobbyConstructor(
        new TextEncoder().encode(JSON.stringify({ hello: true }))
      );
      if (withGC) gc();

      const bytes = new TextEncoder().encode(JSON.stringify({ hello: true }));
      if (withGC) gc();

      const compare = new Uint8Array(await response.arrayBuffer());
      if (withGC) gc();

      for (let i = 0; i < compare.length; i++) {
        if (withGC) gc();

        expect(compare[i]).toBe(bytes[i]);
        if (withGC) gc();
      }
      if (withGC) gc();
    });

    hasBlobFn &&
      it(`blob${withGC ? " (with gc) " : ""}`, async () => {
        if (withGC) gc();
        var response = blobbyConstructor(JSON.stringify({ hello: true }));
        if (withGC) gc();
        const size = JSON.stringify({ hello: true }).length;
        if (withGC) gc();
        const blobed = await response.blob();
        if (withGC) gc();
        expect(blobed instanceof Blob).toBe(true);
        if (withGC) gc();
        expect(blobed.size).toBe(size);
        if (withGC) gc();
        expect(blobed.type).toBe("");
        if (withGC) gc();
        blobed.type = "application/json";
        if (withGC) gc();
        expect(blobed.type).toBe("application/json");
        if (withGC) gc();
      });
  }
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

  for (let withGC of [false, true]) {
    it(`Blob.slice() ${withGC ? " with gc" : ""}`, async () => {
      var parts = ["hello", " ", "world"];
      if (withGC) gc();
      var str = parts.join("");
      if (withGC) gc();
      var combined = new Blob(parts);
      if (withGC) gc();
      for (let part of parts) {
        if (withGC) gc();
        expect(
          await combined
            .slice(str.indexOf(part), str.indexOf(part) + part.length)
            .text()
        ).toBe(part);
        if (withGC) gc();
      }
      if (withGC) gc();
      for (let part of parts) {
        if (withGC) gc();
        expect(
          await combined
            .slice(str.indexOf(part), str.indexOf(part) + part.length)
            .text()
        ).toBe(part);
        if (withGC) gc();
      }
    });
  }
});

describe("Response", () => {
  it("clone", async () => {
    gc();
    var body = new Response("<div>hello</div>", {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
    gc();
    var clone = body.clone();
    gc();
    body.headers.set("content-type", "text/plain");
    gc();
    expect(clone.headers.get("content-type")).toBe("text/html; charset=utf-8");
    gc();
    expect(body.headers.get("content-type")).toBe("text/plain");
    gc();
    expect(await clone.text()).toBe("<div>hello</div>");
    gc();
  });
  testBlobInterface((data) => new Response(data), true);
});

describe("Request", () => {
  it("clone", async () => {
    gc();
    var body = new Request("https://hello.com", {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      body: "<div>hello</div>",
    });
    gc();
    expect(body.headers.get("content-type")).toBe("text/html; charset=utf-8");
    gc();
    var clone = body.clone();
    gc();
    body.headers.set("content-type", "text/plain");
    gc();
    expect(clone.headers.get("content-type")).toBe("text/html; charset=utf-8");
    gc();
    expect(body.headers.get("content-type")).toBe("text/plain");
    gc();
    expect(await clone.text()).toBe("<div>hello</div>");
    gc();
  });

  testBlobInterface(
    (data) => new Request("https://hello.com", { body: data }),
    true
  );
});

describe("Headers", () => {
  it("writes", async () => {
    var headers = new Headers({
      "content-type": "text/html; charset=utf-8",
    });
    gc();
    expect(headers.get("content-type")).toBe("text/html; charset=utf-8");
    gc();
    headers.delete("content-type");
    gc();
    expect(headers.get("content-type")).toBe(null);
    gc();
    headers.append("content-type", "text/plain");
    gc();
    expect(headers.get("content-type")).toBe("text/plain");
    gc();
    headers.append("content-type", "text/plain");
    gc();
    expect(headers.get("content-type")).toBe("text/plain, text/plain");
    gc();
    headers.set("content-type", "text/html; charset=utf-8");
    gc();
    expect(headers.get("content-type")).toBe("text/html; charset=utf-8");

    headers.delete("content-type");
    gc();
    expect(headers.get("content-type")).toBe(null);
    gc();
  });
});
