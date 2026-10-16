import jwt from "jsonwebtoken";
import { generateKeyPairSync } from "node:crypto";

const token = jwt.sign({ sub: "ada", iat: 1700000000 }, "smoke-key", { algorithm: "HS256" });
console.log(token);
console.log(JSON.stringify(jwt.verify(token, "smoke-key")), JSON.stringify(jwt.decode(token, { complete: true })?.header));
for (const attempt of [() => jwt.verify(token, "other"), () => jwt.verify(jwt.sign({ exp: 1 }, "k"), "k"), () => jwt.verify("a.b.c", "k")]) {
  try { attempt(); } catch (error) { console.log((error as Error).name, (error as Error).message); }
}
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
console.log((jwt.verify(jwt.sign({ sub: "rsa" }, privateKey, { algorithm: "RS256" }), publicKey) as jwt.JwtPayload).sub);
const elliptic = generateKeyPairSync("ec", { namedCurve: "P-256" });
console.log((jwt.verify(jwt.sign({ sub: "ec" }, elliptic.privateKey, { algorithm: "ES256" }), elliptic.publicKey) as jwt.JwtPayload).sub);
console.log("DONE");
