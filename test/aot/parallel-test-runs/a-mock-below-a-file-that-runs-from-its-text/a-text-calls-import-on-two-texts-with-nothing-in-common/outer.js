import "./served.js"; const [a, b] = await Promise.all([import("./uses-one.js"), import("./uses-two.js")]); export const seen = a.seen + " & " + b.seen;
