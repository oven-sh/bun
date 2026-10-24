// The toString of a String object throws something that is no object while native code asks it for its text.
import { parseEnv } from "node:util";
import path from "node:path";
function odd(thrown) { const text = new String("A=1"); text.toString = () => { throw thrown; }; text[Symbol.toPrimitive] = () => { throw thrown; }; return text; }
function kind(e) { return typeof e === "number" ? "number " + (e + 1) : typeof e === "string" ? "string " + e.length : e === undefined ? "undefined" : e === null ? "null" : "object " + e.constructor.name; }
function env(text) { try { return JSON.stringify(parseEnv(text)); } catch (e) { return kind(e); } }
function base(text) { try { return path.basename(text); } catch (e) { return kind(e); } }
function joined(text) { try { return path.join("a", text); } catch (e) { return kind(e); } }
function resolved(text) { try { return typeof path.resolve(text); } catch (e) { return kind(e); } }
for (const f of [env, base, joined, resolved]) console.log(f.name, f("A=1"), f(odd(1)), f(odd("text")), f(odd(undefined)), f(odd(null)), f(new String("B=2")));
