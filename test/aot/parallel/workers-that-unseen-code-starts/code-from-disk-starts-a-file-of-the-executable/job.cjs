console.log("printed by the job");
let refused;
try { process.chdir("/"); } catch (error) { refused = error.code; }
require(Buffer.from(process.cwd() + "/unseen.cjs").toString()).post("the job ran, " + refused);
