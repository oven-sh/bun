try { console.log("root:", String(require("./root.mjs").ok)); } catch (error) { console.log("root:", error.message); }
try { console.log("left:", String(require("./left.mjs").ok)); } catch (error) { console.log("left:", error.message); }
try { console.log("left back:", String(require("./left-back.mjs").ok)); } catch (error) { console.log("left back:", error.message); }
try { console.log("right:", String(require("./right.mjs").ok)); } catch (error) { console.log("right:", error.message); }
try { console.log("right back:", String(require("./right-back.mjs").ok)); } catch (error) { console.log("right back:", error.message); }
