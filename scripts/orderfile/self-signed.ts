/**
 * Self-signed TLS certificates for the app workloads' local servers
 * (app/net-server.js), made at trace time so none is committed and none
 * expires in the tree. node:crypto makes the keys and the signature; the X.509
 * structure around them is small enough to write out here, which avoids
 * depending on an `openssl` binary being on the machine that traces.
 *
 * The certificate is its own CA (basicConstraints CA:TRUE) for `localhost` and
 * 127.0.0.1: the clients trust exactly this certificate through their `ca`
 * option, the way an application pins a private CA.
 */
import type { KeyObject } from "node:crypto";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

/** DER: tag, definite length, contents. */
function der(tag: number, ...contents: Uint8Array[]): Buffer {
  const body = Buffer.concat(contents);
  if (body.length < 0x80) return Buffer.concat([Buffer.from([tag, body.length]), body]);
  const length: number[] = [];
  for (let n = body.length; n > 0; n = Math.floor(n / 256)) length.unshift(n % 256);
  return Buffer.concat([Buffer.from([tag, 0x80 | length.length, ...length]), body]);
}

const SEQUENCE = 0x30;
const SET = 0x31;
const NULL = der(0x05);

function oid(dotted: string): Buffer {
  const [first, second, ...rest] = dotted.split(".").map(Number);
  const bytes = [first! * 40 + second!];
  for (const arc of rest) {
    const chunk = [arc & 0x7f];
    for (let n = arc >>> 7; n > 0; n >>>= 7) chunk.unshift((n & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
}

/** YYMMDDHHMMSSZ. UTCTime is what X.509 uses for dates before 2050. */
function utcTime(date: Date): Buffer {
  const text = date.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z";
  return der(0x17, Buffer.from(text, "latin1"));
}

function pem(label: string, bytes: Uint8Array): string {
  const base64 = Buffer.from(bytes).toString("base64").replace(/.{64}/g, "$&\n").trimEnd();
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`;
}

const SIGNATURE_ALGORITHMS = {
  // sha256WithRSAEncryption carries an explicit NULL; ecdsa-with-SHA256 carries no parameters.
  rsa: der(SEQUENCE, oid("1.2.840.113549.1.1.11"), NULL),
  ec: der(SEQUENCE, oid("1.2.840.10045.4.3.2")),
};

function certificate(kind: "rsa" | "ec", publicKey: KeyObject, privateKey: KeyObject): Buffer {
  const algorithm = SIGNATURE_ALGORITHMS[kind];
  const name = der(SEQUENCE, der(SET, der(SEQUENCE, oid("2.5.4.3"), der(0x0c, Buffer.from("localhost")))));
  const day = 24 * 60 * 60 * 1000;
  const validity = der(SEQUENCE, utcTime(new Date(Date.now() - day)), utcTime(new Date(Date.now() + 30 * day)));
  const subjectAltName = der(
    SEQUENCE,
    der(0x82, Buffer.from("localhost")), // dNSName
    der(0x87, Buffer.from([127, 0, 0, 1])), // iPAddress
  );
  const extensions = der(
    SEQUENCE,
    der(
      SEQUENCE,
      oid("2.5.29.19"),
      der(0x01, Buffer.from([0xff])),
      der(0x04, der(SEQUENCE, der(0x01, Buffer.from([0xff])))),
    ),
    der(SEQUENCE, oid("2.5.29.17"), der(0x04, subjectAltName)),
  );
  // A positive INTEGER: the top bit of the first byte is clear.
  const serial = randomBytes(16);
  serial[0]! &= 0x7f;
  serial[0]! |= 0x01;
  const tbs = der(
    SEQUENCE,
    der(0xa0, der(0x02, Buffer.from([2]))), // v3
    der(0x02, serial),
    algorithm,
    name, // issuer
    validity,
    name, // subject
    publicKey.export({ type: "spki", format: "der" }),
    der(0xa3, extensions),
  );
  const signature = sign("sha256", tbs, privateKey);
  return der(SEQUENCE, tbs, algorithm, der(0x03, Buffer.from([0]), signature));
}

export interface SelfSigned {
  /** PEM certificate. */
  cert: string;
  /** PEM PKCS#8 private key. */
  key: string;
}

export function selfSignedCertificate(kind: "rsa" | "ec"): SelfSigned {
  const { publicKey, privateKey } =
    kind === "rsa"
      ? generateKeyPairSync("rsa", { modulusLength: 2048 })
      : generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    cert: pem("CERTIFICATE", certificate(kind, publicKey, privateKey)),
    key: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  };
}
