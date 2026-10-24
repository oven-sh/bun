exports.createElement = (t, p, ...c) => [typeof t === "function" ? "component" : String(t), p ? Object.keys(p).join() : "-", c.length].join(":");
exports.Fragment = "fragment";
