// The body throws in front of the declaration: the variable stays in its dead zone for good, for compiled code and for the run time.
const pick = name => (process.argv.length > 100 ? "x" : "") + name;
try { await import(pick("./m.mjs")); } catch (e) { console.log(e.message); }
console.log(globalThis.kept.peek());
try { console.log(typeof globalThis.kept.take()); } catch (e) { console.log(e.name); }
try { const again = await import(pick("./m.mjs")); console.log(typeof again.arrow); } catch (e) { console.log(e.message); }
