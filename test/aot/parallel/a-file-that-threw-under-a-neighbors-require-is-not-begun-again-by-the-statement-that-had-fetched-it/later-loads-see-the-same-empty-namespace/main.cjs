console.log("main got:", require("./pantry.mjs").pantry);
console.log("main got:", require("./cellar.mjs").cellar);
import("./kettle.cjs").then(kettle => console.log("later:", JSON.stringify(Object.keys(kettle)) + " " + JSON.stringify(kettle.default)));
