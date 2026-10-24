// The error codes whose error keeps an operand as it is: the object that goes in is the object that comes out.
import { EventEmitter } from "node:events";
import tls from "node:tls";
import url from "node:url";
process.noDeprecation = true;
const say = (...values: unknown[]) => console.log(...values);
function caught(run: () => unknown): any {
  try { return { answered: run() }; } catch (e) { return e; }
}
const certificate = { subject: { CN: "other.example" }, marker: { kept: true } };
const mismatch = tls.checkServerIdentity("host.example", certificate as any) as any;
say(mismatch.code, mismatch.name, mismatch instanceof Error, mismatch.host, typeof mismatch.reason, mismatch.cert === certificate, mismatch.cert.marker.kept, String(mismatch).split("\n")[0]);
const unhandled = caught(() => new EventEmitter().emit("error", { not: "an error" }));
say(unhandled.code, unhandled.name, unhandled.message, unhandled.context.not);
const thrown = new RangeError("mine");
say(caught(() => new EventEmitter().emit("error", thrown)) === thrown);
const invalid = caught(() => url.parse("http://[a b]/"));
say(invalid.code, invalid.name, invalid.input, Object.keys(invalid).join());
const ciphers = caught(() => tls.createSecureContext({ ciphers: "nope" }));
say(ciphers.code, ciphers.reason, ciphers.library, ciphers.message);
for (const error of [mismatch, unhandled, invalid]) {
  const hidden = Object.getPrototypeOf(error);
  say(Object.hasOwn(error, "code"), Object.hasOwn(hidden, "code"), Object.hasOwn(hidden, "name"), typeof hidden.toString, hidden.toString === Error.prototype.toString, Object.getPrototypeOf(hidden).constructor.name);
}
