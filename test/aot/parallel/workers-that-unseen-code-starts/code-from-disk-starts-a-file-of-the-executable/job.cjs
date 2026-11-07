console.log("printed by the job");
let refused;
try { process.chdir("/"); } catch (error) { refused = error.code; }
postMessage("the job ran, " + refused);
