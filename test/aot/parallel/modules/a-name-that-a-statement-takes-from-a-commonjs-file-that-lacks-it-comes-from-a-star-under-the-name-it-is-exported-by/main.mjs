const said = [];
async function take(load) { try { said.push(String((await load()).seen)); } catch (error) { said.push(error.name); } }
await take(() => import("./n1.mjs")); await take(() => import("./n2.mjs"));
console.log("SAID " + said.join(" | "));
