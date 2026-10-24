import crypto from "node:crypto";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
console.log(publicKey.type, privateKey.type, publicKey.asymmetricKeyType, publicKey.asymmetricKeyDetails);
const signature = crypto.sign("sha256", Buffer.from("document"), privateKey);
console.log(crypto.verify("sha256", Buffer.from("document"), publicKey, signature), crypto.verify("sha256", Buffer.from("forged"), publicKey, signature));
const signer = crypto.createSign("SHA256").update("in ").update("pieces");
console.log(crypto.createVerify("SHA256").update("in pieces").verify(publicKey, signer.sign(privateKey)));
const pem = publicKey.export({ type: "spki", format: "pem" });
console.log(pem.split("\n")[0], crypto.createPublicKey(pem).equals(publicKey), Object.keys(publicKey.export({ format: "jwk" })).sort().join(), crypto.createPublicKey(privateKey).equals(publicKey));

const ed = crypto.generateKeyPairSync("ed25519");
console.log(crypto.verify(null, Buffer.from("m"), ed.publicKey, crypto.sign(null, Buffer.from("m"), ed.privateKey)), ed.publicKey.export({ type: "spki", format: "der" }).length);
const alice = crypto.createECDH("prime256v1");
const bob = crypto.createECDH("prime256v1");
alice.generateKeys();
bob.generateKeys();
console.log(alice.computeSecret(bob.getPublicKey()).equals(bob.computeSecret(alice.getPublicKey())), alice.getPublicKey("hex").length, crypto.getCurves().includes("secp256k1"));
const x1 = crypto.generateKeyPairSync("x25519");
const x2 = crypto.generateKeyPairSync("x25519");
console.log(crypto.diffieHellman({ privateKey: x1.privateKey, publicKey: x2.publicKey }).equals(crypto.diffieHellman({ privateKey: x2.privateKey, publicKey: x1.publicKey })));
const secret = crypto.createSecretKey(Buffer.alloc(32, 1));
console.log(secret.type, secret.symmetricKeySize, secret.export().length, crypto.KeyObject.name, secret instanceof crypto.KeyObject);
console.log(crypto.hkdfSync("sha256", "key", "salt", "info", 16).byteLength, Buffer.from(crypto.hkdfSync("sha256", "key", "salt", "info", 8)).toString("hex"), crypto.getCiphers().includes("aes-128-cbc"), crypto.getCipherInfo("aes-256-gcm").ivLength);
const rsa = await new Promise((resolve, reject) => crypto.generateKeyPair("rsa", { modulusLength: 2048 }, (error, publicKey, privateKey) => (error ? reject(error) : resolve({ publicKey, privateKey }))));
const sealed = crypto.publicEncrypt(rsa.publicKey, Buffer.from("for your eyes"));
console.log(sealed.length, crypto.privateDecrypt(rsa.privateKey, sealed).toString(), rsa.publicKey.asymmetricKeyDetails.modulusLength);
try {
  crypto.createPrivateKey("not a key");
} catch (error) {
  console.log(error.name, typeof error.code);
}
console.log(crypto.webcrypto.subtle === globalThis.crypto.subtle, typeof crypto.constants.RSA_PKCS1_PADDING, crypto.randomBytes(4).toString("hex").length, crypto.checkPrimeSync(7n), crypto.generatePrimeSync(16, { bigint: true }) > 0n);
