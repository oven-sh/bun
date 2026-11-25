const said = [];
async function take(load) { try { said.push(String((await load()).seen)); } catch (error) { said.push(error.name + " " + String(error.message).slice(0, 50)); } }
await take(() => import("./n1.mjs"));
console.log("SAID " + said.join(" | "));
