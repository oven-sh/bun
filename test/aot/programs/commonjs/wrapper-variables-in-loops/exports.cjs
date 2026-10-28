var i = 0;
while (i < 2) { exports = i; i++; }
console.log("exports after while:", exports, typeof module.exports);
for (var j = 0; j < 3; j++) { console.log("exports at the start of iteration " + j + ":", exports); exports = "for " + j; }
do { exports += "!"; } while (exports.length < 8);
console.log("exports after do:", exports);
try { exports = "try"; throw 0; } catch (e) { console.log("exports in catch:", exports); }
