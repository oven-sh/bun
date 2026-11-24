const s = "hello";
console.log(s.slice(...[1, 3]), s.indexOf(...["l"]), s.charCodeAt(...[0]), s.startsWith(...["he"]), s.at(...[-1]), s.padStart(...[7, "-"]), s.replace(...["l", "L"]));
export {};
