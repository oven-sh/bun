// What the initializer reads is not the same at all times. The variable holds what was there where the declaration stands.
// Alone: what is put off goes by all that the executable holds
import { read } from "./m.mjs";
process.env.DEFER_PROBE = "late";
try { console.log(JSON.stringify(read().seen)); } catch (e) { console.log(e.name + ": " + e.message); }
