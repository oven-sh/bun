import * as jose from "jose";

const key = new TextEncoder().encode("a-smoke-key-of-thirty-two-bytes!");
const token = await new jose.SignJWT({ role: "admin" }).setProtectedHeader({ alg: "HS256" }).setSubject("ada").setIssuedAt(1700000000).sign(key);
console.log(token);
console.log(JSON.stringify((await jose.jwtVerify(token, key)).payload), JSON.stringify(jose.decodeProtectedHeader(token)));
try { await jose.jwtVerify(token, new TextEncoder().encode("another-key-of-thirty-two-bytes!")); } catch (error) { console.log((error as jose.errors.JOSEError).code); }
const sealed = await new jose.EncryptJWT({ secret: 42 }).setProtectedHeader({ alg: "dir", enc: "A256GCM" }).encrypt(key);
console.log((await jose.jwtDecrypt(sealed, key)).payload.secret);
const pair = await jose.generateKeyPair("ES256", { extractable: true });
const signed = await new jose.SignJWT({}).setProtectedHeader({ alg: "ES256" }).setSubject("ec").sign(pair.privateKey);
const jwk = await jose.exportJWK(pair.publicKey);
console.log((await jose.jwtVerify(signed, await jose.importJWK(jwk, "ES256"))).payload.sub, jwk.kty, jwk.crv);
console.log("DONE");
