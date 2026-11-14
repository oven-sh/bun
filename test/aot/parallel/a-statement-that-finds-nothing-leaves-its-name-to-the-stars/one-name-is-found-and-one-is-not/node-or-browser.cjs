exports.measure = "measured";
if (typeof window !== "undefined") exports.paint = window.paint;
if (typeof window === "undefined") exports.stroke = "stroke of node";
