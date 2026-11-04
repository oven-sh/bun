globalThis.hook = () => require("./second.mjs").ok;
try { require("./first.mjs"); } catch (error) { console.log("first:", error.message); }
try { console.log("second:", require("./second.mjs").ok); } catch (error) { console.log("second:", error.message); }
