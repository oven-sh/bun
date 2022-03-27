import { describe, it, expect } from "bun:test";

describe("url", () => {
  it("works", () => {
    const inputs: [
      [
        string,
        {
          hash: string;
          host: string;
          hostname: string;
          href: string;
          origin: string;
          password: string;
          pathname: string;
          port: string;
          protocol: string;
          search: string;
          username: string;
        }
      ]
    ] = [
      [
        "https://username:password@api.foo.bar.com:9999/baz/okay/i/123?ran=out&of=things#to-use-as-a-placeholder",
        {
          hash: "#to-use-as-a-placeholder",
          host: "api.foo.bar.com:9999",
          hostname: "api.foo.bar.com",
          href: "https://username:password@api.foo.bar.com:9999/baz/okay/i/123?ran=out&of=things#to-use-as-a-placeholder",
          origin: "https://api.foo.bar.com:9999",
          password: "password",
          pathname: "/baz/okay/i/123",
          port: "9999",
          protocol: "https:",
          search: "?ran=out&of=things",
          username: "username",
        },
      ],
      [
        "https://url.spec.whatwg.org/#url-serializing",
        {
          hash: "#url-serializing",
          host: "url.spec.whatwg.org",
          hostname: "url.spec.whatwg.org",
          href: "https://url.spec.whatwg.org/#url-serializing",
          origin: "https://url.spec.whatwg.org",
          password: "",
          pathname: "/",
          port: "",
          protocol: "https:",
          search: "",
          username: "",
        },
      ],
      [
        "https://url.spec.whatwg.org#url-serializing",
        {
          hash: "#url-serializing",
          host: "url.spec.whatwg.org",
          hostname: "url.spec.whatwg.org",
          href: "https://url.spec.whatwg.org/#url-serializing",
          origin: "https://url.spec.whatwg.org",
          password: "",
          pathname: "/",
          port: "",
          protocol: "https:",
          search: "",
          username: "",
        },
      ],
    ];

    for (let [url, values] of inputs) {
      const result = new URL(url);
      expect(result.hash).toBe(values.hash);
      expect(result.host).toBe(values.host);
      expect(result.hostname).toBe(values.hostname);
      expect(result.href).toBe(values.href);
      expect(result.origin).toBe(values.origin);
      expect(result.password).toBe(values.password);
      expect(result.pathname).toBe(values.pathname);
      expect(result.port).toBe(values.port);
      expect(result.protocol).toBe(values.protocol);
      expect(result.search).toBe(values.search);
      expect(result.username).toBe(values.username);
    }

    expect(new URL("example.com").pathname).toBe("/");
    expect(new URL("https://example.com").protocol).toBe("https:");
    expect(new URL("http://example.com").protocol).toBe("http:");
    expect(new URL("example.com/foo").pathname).toBe("/foo");
    expect(new URL("example.com/foo/bar/").pathname).toBe("/foo/bar/");
    expect(new URL("example.com/foo/bar/?search=true").search).toBe(
      "?search=true"
    );
    expect(new URL("example.com/foo/bar/?search=true#fragment").search).toBe(
      "?search=true"
    );
    expect(new URL("https://example.com").href).toBe("https://example.com/");
    expect(new URL("example.com").hostname).toBe("example.com");
  });
});
