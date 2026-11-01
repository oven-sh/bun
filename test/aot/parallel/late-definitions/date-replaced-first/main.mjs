// `class K extends Error` reads the global. The program gives the global another value before the file of the class is loaded, or before the first read of the class.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import "./first.mjs";
const { read } = await import("./m.mjs");
say(() => (() => { const K = read(); const above = Object.getPrototypeOf(K); let made; try { made = new K(); } catch (e) { made = { threw: e.name }; } return [above.name, above === globalThis.Date, made.fake === true, made.threw].join(); })());
