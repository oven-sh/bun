globalThis.hook = () => { try { return require("./outside.mjs").seen; } catch (error) { return "caught " + error.message; } };
try { console.log("first:", String(require("./first.mjs").ok)); } catch (error) { console.log("first:", error.message); }
try { console.log("second:", String(require("./second.mjs").ok)); } catch (error) { console.log("second:", error.message); }
try { console.log("outside:", String(require("./outside.mjs").seen)); } catch (error) { console.log("outside:", error.message); }
