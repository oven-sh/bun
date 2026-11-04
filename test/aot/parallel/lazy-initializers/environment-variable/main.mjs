// What the initializer reads is not the same at all times. The variable holds what was there where the declaration stands.
import { read } from "./m.mjs";
process.env.DEFER_PROBE = "late";
try { console.log(JSON.stringify(read().seen)); } catch (e) { console.log(e.name + ": " + e.message); }
