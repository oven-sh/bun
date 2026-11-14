import "./served.js"; const both = await import("./uses-both.js"); export const seen = both.seen;
