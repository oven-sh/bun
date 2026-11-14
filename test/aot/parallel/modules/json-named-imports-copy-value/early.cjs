let names;
try {
  names = Object.keys(require("./app.mjs")).join();
} catch (error) {
  names = String(error).slice(0, 40);
}
const data = require("./list.json");
console.log("early", Object.keys(data).join());
data.inner.seen = true;
data.added = 1;
