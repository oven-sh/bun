const line = [];
globalThis.log = word => line.push(word);
globalThis.keep = (name, promise) => promise.then(() => line.push(name + "+"), error => line.push(name + "!" + (error && error.message)));
globalThis.inner = () => require("./first.mjs").name;
try { require("./outer.mjs"); log("+"); } catch (error) { log("threw " + (error && error.message)); }
setTimeout(() => console.log(line.join(" ")), 200);
