// url.host = value, url.hostname = value and the hostname of a URLPattern: 8-bit and 16-bit values, short and
// 800-character URLs, international names, and values that do not set the host.
import { bench, group, run } from "../runner.mjs";

// The same characters in a 16-bit string.
const wide = s => Buffer.from(s, "utf16le").toString("utf16le");

const short = "http://x:8080/p";
const long = "http://x:8080/" + "p".repeat(400) + "?" + "q".repeat(385);
const host253 = Array.from({ length: 4 }, (_, i) => String.fromCharCode(97 + i).repeat(62)).join(".") + ".ab";

const values = {
  "'a.example'": "a.example",
  "'a.example:81'": "a.example:81",
  "'a.example:80' (default port)": "a.example:80",
  "253 characters": host253,
  "253 characters, upper case": host253.toUpperCase(),
  "upper case": "WWW.Example.COM",
  "IPv4 and port": "192.168.1.10:8080",
  "IPv6": "[2001:db8::8a2e:370:7334]",
  "IPv6 and port": "[2001:db8::8a2e:370:7334]:8080",
  "percent-encoded": "%61.example",
  "xn-- label": "xn--bcher-kva.example",
  "international, Latin-1": "b\u00FCcher.example",
  "'a.example', 16-bit": wide("a.example"),
  "'a.example:81', 16-bit": wide("a.example:81"),
  "253 characters, 16-bit": wide(host253),
  "international, 16-bit": "\u65E5\u672C\u8A9E.jp",
  "international, 60 characters": "\u00E9".repeat(60) + ".example",
};

for (const setter of ["host", "hostname"]) {
  group(`url.${setter} = value, on ${short}`, () => {
    for (const [name, value] of Object.entries(values)) {
      // The hostname setter does not take a port.
      if (setter === "hostname" && /:\d+$/.test(value)) continue;
      const url = new URL(short);
      bench(name, () => {
        url[setter] = value;
      });
    }
  });
}

group("url.host = value, other URLs", () => {
  for (const [name, href, value] of [
    ["800 characters, 'a.example:81'", long, "a.example:81"],
    ["800 characters, international", long, "\u65E5\u672C\u8A9E.jp"],
    ["800 characters in a 16-bit string", wide(long), "a.example:81"],
    ["credentials, port, query and fragment", "https://user:p%40ss@registry.internal:8443/npm/x?y=1#z", "a.example:81"],
    ["not special: foo://x:9/p", "foo://x:9/p", "a.example"],
    ["not special, international", "foo://x:9/p", "\u65E5\u672C\u8A9E.jp"],
    ["not special, 250 upper-case characters", "foo://x:9/p", "A".repeat(250)],
    ["not special, 250 non-ASCII characters", "foo://x:9/p", "\u00E9".repeat(250)],
    ["file://h/a/b", "file://h/a/b", "a.example"],
  ]) {
    const url = new URL(href);
    bench(name, () => {
      url.host = value;
    });
  }
});

group("values that do not set the host", () => {
  for (const [name, href, setter, value] of [
    ["host = ''", short, "host", ""],
    ["host = '/'", short, "host", "/"],
    ["host = 'a b'", short, "host", "a b"],
    ["host = 253 characters and a space", short, "host", host253 + " "],
    ["host = 250 spaces", short, "host", " ".repeat(250)],
    ["host = 250 '['", short, "host", "[".repeat(250)],
    ["hostname = 'a:80'", short, "hostname", "a:80"],
    ["host on mailto: (opaque path)", "mailto:user@example.com", "host", "a.example"],
  ]) {
    const url = new URL(href);
    bench(name, () => {
      url[setter] = value;
    });
  }
});

group("URLPattern hostname", () => {
  const any = new URLPattern({ hostname: "*" });
  bench("new URLPattern({ hostname: 'example.com' })", () => new URLPattern({ hostname: "example.com" }));
  bench("new URLPattern({ hostname: international })", () => new URLPattern({ hostname: "b\u00FCcher.example" }));
  bench("test({ hostname: 'sub.example.com' })", () => any.test({ hostname: "sub.example.com" }));
  bench("test({ hostname: international })", () => any.test({ hostname: "\u65E5\u672C\u8A9E.jp" }));
  bench("test({ hostname: IPv4 })", () => any.test({ hostname: "192.168.1.10" }));
  bench("test({ hostname: IPv6 })", () => any.test({ hostname: "[2001:db8::8a2e:370:7334]" }));
  bench("test({ hostname: 253 characters })", () => any.test({ hostname: host253 }));
  bench("test({ hostname: 253 characters, upper case })", () => any.test({ hostname: host253.toUpperCase() }));
});

await run();
