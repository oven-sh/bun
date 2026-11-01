// Hash, Hmac, Sign, Verify, Cipher, ECDH and DiffieHellman through the functions of node:crypto; a key that cannot be read is an empty string.
import { Certificate, createCipheriv, createECDH, createHash, createHmac, createSign, createVerify, generateKeyPairSync, getDiffieHellman } from "node:crypto";
function hash() { return createHash("sha256").update("a").digest("hex"); }
function hmac() { return createHmac("sha256", "k").update("a").digest("hex"); }
console.log(hash().slice(0, 8), hmac().slice(0, 8));
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
function signed() { return createSign("sha256").update("a").sign(privateKey); }
function verified(signature) { return createVerify("sha256").update("a").verify(publicKey, signature); }
console.log(signed() instanceof Buffer, verified(signed()));
function cipher() { const c = createCipheriv("aes-128-cbc", Buffer.alloc(16), Buffer.alloc(16)); return Buffer.concat([c.update("a"), c.final()]).toString("hex"); }
console.log(cipher());
function curve() { const e = createECDH("prime256v1"); e.generateKeys(); return e.getPublicKey().length; }
console.log(curve());
function group() { return getDiffieHellman("modp14").getPrime().length; }
console.log(group());
function spkac(value) { return [Certificate.verifySpkac(value), Certificate.exportPublicKey(value), Certificate.exportChallenge(value)].map(each => typeof each + ":" + String(each)).join(); }
console.log(spkac(Buffer.from("nothing")));
