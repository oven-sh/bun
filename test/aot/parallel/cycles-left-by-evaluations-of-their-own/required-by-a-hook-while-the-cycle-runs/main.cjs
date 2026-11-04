globalThis.hook = () => require("./outside.mjs").seen;
try { require("./first.mjs"); } catch (error) { console.log("first:", error.message); }
try { console.log("second:", require("./second.mjs").ok); } catch (error) { console.log("second:", error.message); }
try { console.log("outside:", require("./outside.mjs").seen); } catch (error) { console.log("outside:", error.message); }
try { require("./first.mjs"); } catch (error) { console.log("first again:", error.message); }
