import { describe, expect, test } from "bun:test";
import { parseUrlAndHost } from "../src/url-utils";

describe("parseUrlAndHost", () => {
  describe("plain paths", () => {
    test("root path /", () => {
      const result = parseUrlAndHost("/", "localhost");
      expect(result).toEqual({
        "url.path": "/",
        "server.address": "localhost",
      });
    });

    test("api path /api/users", () => {
      const result = parseUrlAndHost("/api/users", "localhost");
      expect(result).toEqual({
        "url.path": "/api/users",
        "server.address": "localhost",
      });
    });

    test("nested path /path/to/resource", () => {
      const result = parseUrlAndHost("/path/to/resource", "example.com");
      expect(result).toEqual({
        "url.path": "/path/to/resource",
        "server.address": "example.com",
      });
    });

    test("path with trailing slash /api/", () => {
      const result = parseUrlAndHost("/api/", "localhost");
      expect(result).toEqual({
        "url.path": "/api/",
        "server.address": "localhost",
      });
    });
  });

  describe("paths with query strings", () => {
    test("search query /search?q=test", () => {
      const result = parseUrlAndHost("/search?q=test", "localhost");
      expect(result).toEqual({
        "url.path": "/search",
        "server.address": "localhost",
        "url.query": "q=test",
      });
    });

    test("multiple query params /api?foo=bar&baz=qux", () => {
      const result = parseUrlAndHost("/api?foo=bar&baz=qux", "localhost");
      expect(result).toEqual({
        "url.path": "/api",
        "server.address": "localhost",
        "url.query": "foo=bar&baz=qux",
      });
    });

    test("empty query string /?", () => {
      const result = parseUrlAndHost("/?", "localhost");
      expect(result).toEqual({
        "url.path": "/",
        "server.address": "localhost",
        // Empty query string should not be included
      });
    });

    test("query with special characters /search?q=hello%20world&lang=en", () => {
      const result = parseUrlAndHost("/search?q=hello%20world&lang=en", "localhost");
      expect(result).toEqual({
        "url.path": "/search",
        "server.address": "localhost",
        "url.query": "q=hello%20world&lang=en",
      });
    });

    test("path with fragment-like query /api?filter=id#123", () => {
      const result = parseUrlAndHost("/api?filter=id#123", "localhost");
      expect(result).toEqual({
        "url.path": "/api",
        "server.address": "localhost",
        "url.query": "filter=id#123",
      });
    });
  });

  describe("IPv6 with port", () => {
    test("loopback with port [::1]:3000", () => {
      const result = parseUrlAndHost("/", "[::1]:3000");
      expect(result).toEqual({
        "url.path": "/",
        "server.address": "[::1]",
        "server.port": 3000,
      });
    });

    test("full IPv6 with port [2001:db8::1]:8080", () => {
      const result = parseUrlAndHost("/api/users", "[2001:db8::1]:8080");
      expect(result).toEqual({
        "url.path": "/api/users",
        "server.address": "[2001:db8::1]",
        "server.port": 8080,
      });
    });

    test("link-local IPv6 with port [fe80::1]:443", () => {
      const result = parseUrlAndHost("/secure", "[fe80::1]:443");
      expect(result).toEqual({
        "url.path": "/secure",
        "server.address": "[fe80::1]",
        "server.port": 443,
      });
    });

    test("IPv6 with zone ID and port [fe80::1%eth0]:8080", () => {
      const result = parseUrlAndHost("/", "[fe80::1%eth0]:8080");
      expect(result).toEqual({
        "url.path": "/",
        "server.address": "[fe80::1%eth0]",
        "server.port": 8080,
      });
    });
  });

  describe("IPv6 without port", () => {
    test("loopback without port [::1]", () => {
      const result = parseUrlAndHost("/", "[::1]");
      expect(result).toEqual({
        "url.path": "/",
        "server.address": "[::1]",
      });
    });

    test("full IPv6 without port [fe80::1]", () => {
      const result = parseUrlAndHost("/api", "[fe80::1]");
      expect(result).toEqual({
        "url.path": "/api",
        "server.address": "[fe80::1]",
      });
    });

    test("expanded IPv6 [2001:0db8:85a3:0000:0000:8a2e:0370:7334]", () => {
      const result = parseUrlAndHost("/", "[2001:0db8:85a3:0000:0000:8a2e:0370:7334]");
      expect(result).toEqual({
        "url.path": "/",
        "server.address": "[2001:0db8:85a3:0000:0000:8a2e:0370:7334]",
      });
    });
  });

  describe("regular host:port", () => {
    test("localhost with port localhost:3000", () => {
      const result = parseUrlAndHost("/", "localhost:3000");
      expect(result).toEqual({
        "url.path": "/",
        "server.address": "localhost",
        "server.port": 3000,
      });
    });

    test("domain with port example.com:443", () => {
      const result = parseUrlAndHost("/api", "example.com:443");
      expect(result).toEqual({
        "url.path": "/api",
        "server.address": "example.com",
        "server.port": 443,
      });
    });

    test("IP address with port 192.168.1.1:8080", () => {
      const result = parseUrlAndHost("/status", "192.168.1.1:8080");
      expect(result).toEqual({
        "url.path": "/status",
        "server.address": "192.168.1.1",
        "server.port": 8080,
      });
    });

    test("subdomain with port api.example.com:9000", () => {
      const result = parseUrlAndHost("/v1/users", "api.example.com:9000");
      expect(result).toEqual({
        "url.path": "/v1/users",
        "server.address": "api.example.com",
        "server.port": 9000,
      });
    });
  });

  describe("host only (no port)", () => {
    test("localhost without port", () => {
      const result = parseUrlAndHost("/", "localhost");
      expect(result).toEqual({
        "url.path": "/",
        "server.address": "localhost",
      });
    });

    test("domain without port example.com", () => {
      const result = parseUrlAndHost("/api/data", "example.com");
      expect(result).toEqual({
        "url.path": "/api/data",
        "server.address": "example.com",
      });
    });

    test("subdomain without port api.example.com", () => {
      const result = parseUrlAndHost("/", "api.example.com");
      expect(result).toEqual({
        "url.path": "/",
        "server.address": "api.example.com",
      });
    });

    test("IP address without port 192.168.1.1", () => {
      const result = parseUrlAndHost("/health", "192.168.1.1");
      expect(result).toEqual({
        "url.path": "/health",
        "server.address": "192.168.1.1",
      });
    });
  });

  describe("edge cases", () => {
    test("empty URL defaults to /", () => {
      const result = parseUrlAndHost("", "localhost");
      expect(result).toEqual({
        "url.path": "/",
        "server.address": "localhost",
      });
    });

    test("complex query string with multiple ? characters", () => {
      const result = parseUrlAndHost("/search?q=what?how?", "localhost");
      expect(result).toEqual({
        "url.path": "/search",
        "server.address": "localhost",
        "url.query": "q=what?how?",
      });
    });

    test("malformed IPv6 bracket without closing bracket [::1", () => {
      const result = parseUrlAndHost("/", "[::1");
      expect(result).toEqual({
        "url.path": "/",
        "server.address": "[::1",
      });
    });

    test("port zero localhost:0", () => {
      const result = parseUrlAndHost("/", "localhost:0");
      expect(result).toEqual({
        "url.path": "/",
        "server.address": "localhost",
        "server.port": 0,
      });
    });

    test("non-numeric port localhost:abc (should not include port)", () => {
      const result = parseUrlAndHost("/", "localhost:abc");
      expect(result).toEqual({
        "url.path": "/",
        "server.address": "localhost",
      });
    });

    test("combined: IPv6 with port and query string", () => {
      const result = parseUrlAndHost("/search?q=test&lang=en", "[::1]:3000");
      expect(result).toEqual({
        "url.path": "/search",
        "server.address": "[::1]",
        "server.port": 3000,
        "url.query": "q=test&lang=en",
      });
    });

    test("combined: regular host:port with query", () => {
      const result = parseUrlAndHost("/api/v1/users?id=123", "api.example.com:8080");
      expect(result).toEqual({
        "url.path": "/api/v1/users",
        "server.address": "api.example.com",
        "server.port": 8080,
        "url.query": "id=123",
      });
    });
  });
});
