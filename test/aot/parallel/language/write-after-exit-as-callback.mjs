// process.exit passed to forEach as the callback before a write to a locked built-in.
console.log("done");
[0].forEach(process.exit);
Array.prototype.push = function () {};
