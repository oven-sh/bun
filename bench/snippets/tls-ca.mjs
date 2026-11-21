// tls.createSecureContext() by what its list of CA certificates holds.
import { existsSync, readFileSync } from "node:fs";
import tls from "node:tls";
import { bench, run } from "../runner.mjs";

const der = pem => Buffer.from(pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, ""), "base64");
const pem = der =>
  `-----BEGIN CERTIFICATE-----\n${der
    .toString("base64")
    .match(/.{1,64}/g)
    .join("\n")}\n-----END CERTIFICATE-----\n`;
// One DER element.
function tlv(tag, ...parts) {
  const body = Buffer.concat(parts);
  const length =
    body.length < 0x80
      ? [body.length]
      : body.length < 0x100
        ? [0x81, body.length]
        : [0x82, body.length >> 8, body.length & 0xff];
  return Buffer.concat([Buffer.from([tag, ...length]), body]);
}
// The length of the header of one, and the elements inside it.
const header = (element, at = 0) => 2 + (element[at + 1] & 0x80 ? element[at + 1] & 0x7f : 0);
function elements(element) {
  const found = [];
  for (let at = header(element); at < element.length;) {
    const head = header(element, at);
    const end = at + head + (head > 2 ? element.readUIntBE(at + 2, head - 2) : element[at + 1]);
    found.push(element.subarray(at, end));
    at = end;
  }
  return found;
}

const roots = tls.rootCertificates;
// Certificates that no runtime bundles: each root with one byte more in its signature.
const others = roots.map(root => {
  const [tbs, algorithm, signature] = elements(der(root));
  return pem(tlv(0x30, tbs, algorithm, tlv(0x03, signature.subarray(header(signature)), Buffer.from([0]))));
});
// The same, of the lengths of the roots: each root with the last byte of its signature changed.
const twins = roots.map(root => {
  const twin = der(root);
  twin[twin.length - 1] ^= 1;
  return pem(twin);
});
const systemBundle = ["/etc/ssl/certs/ca-certificates.crt", "/etc/ssl/cert.pem"].find(path => existsSync(path));

const lists = {
  "1 certificate": [others[0]],
  [`${roots.length} bundled roots`]: [...roots],
  [`${roots.length} bundled roots, 1 string`]: roots.join("\n"),
  [`${roots.length} bundled roots + 1 certificate`]: [...roots, others[0]],
  "half bundled roots, half not": roots.map((root, i) => (i % 2 ? root : others[i])),
  [`${others.length} certificates`]: others,
  [`${twins.length} roots but for 1 byte`]: twins,
  ...(systemBundle && { "the system bundle": readFileSync(systemBundle, "utf8") }),
};

for (const [name, ca] of Object.entries(lists)) {
  bench(`ca: ${name}`, () => tls.createSecureContext({ ca }));
}

// The override is the list of each context that has no `ca`.
tls.setDefaultCACertificates([...roots, others[0]]);
bench(`setDefaultCACertificates: ${roots.length} bundled roots + 1`, () => tls.createSecureContext());

await run();
