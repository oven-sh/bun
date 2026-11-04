// Promises of an ArrayBuffer and of a boolean; a rejection carries an error that the host has made.
const data = new TextEncoder().encode("abc");
function digest() { return crypto.subtle.digest("SHA-256", data); }
const hashed = await digest(); console.log(hashed instanceof ArrayBuffer, hashed.byteLength, new Uint8Array(hashed)[0], typeof hashed.slice);
const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, true, ["sign", "verify"]);
function sign() { return crypto.subtle.sign("HMAC", key, data); }
const signed = await sign(); console.log(signed instanceof ArrayBuffer, signed.byteLength);
function verify() { return crypto.subtle.verify("HMAC", key, signed, data); }
const ok = await verify(); console.log(typeof ok, ok);
try { await crypto.subtle.digest("nothing", data); } catch (error) { console.log(error.name, error instanceof DOMException, typeof error.code); }
