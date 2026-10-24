function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return Object.prototype.toString.call(value);
}

function attempt(label, run) {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "-> threw", error.constructor.name);
  }
}

module.exports = { show, attempt };
