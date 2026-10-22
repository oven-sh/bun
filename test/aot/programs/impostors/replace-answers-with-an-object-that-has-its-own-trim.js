const pattern = { [Symbol.replace]: () => ({ trim: () => "trimmed" }) };
console.log("a,b".replace(pattern, "").trim());
