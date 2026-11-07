// A CommonJS file that only import() asks for requires a file that throws. The file that threw has failed: whoever asks for it later, by require() or by import(), gets the same error.
try { await import("./r1.cjs") } catch (e) { console.log("first", e.message) }
try { console.log((await import("./r2.cjs")).default.a) } catch (e) { console.log("second", e.message) }
try { await import("./bad.cjs") } catch (e) { console.log("third", e.message) }
console.log("end");
