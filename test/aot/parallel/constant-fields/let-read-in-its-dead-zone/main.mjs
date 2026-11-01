// A variable that is stored one constant is read as that constant, but for a read that comes before the store.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { peek, early } from "./m.mjs";
say(() => early + " " + peek());
