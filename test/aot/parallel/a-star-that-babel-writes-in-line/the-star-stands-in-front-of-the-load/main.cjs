function say(f) { try { console.log(String(f())); } catch (e) { console.log(e.constructor.name + ": " + String(e.message).slice(0, 24)); } }
say(() => Object.keys(require("./barrel.cjs")).length);
