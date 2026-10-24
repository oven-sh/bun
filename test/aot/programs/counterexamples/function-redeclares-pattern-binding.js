// A function declaration replaces a parameter name that a pattern binds.
function o({ p }) { function p() {} return typeof p; }
console.log(o({ p: 0 }));
