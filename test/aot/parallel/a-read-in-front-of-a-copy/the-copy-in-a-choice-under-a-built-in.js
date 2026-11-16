function copyOf(o) { return structuredClone(typeof o.price === "function" ? 0 : { ...o }).price; }
console.log(String(copyOf({ price: 1.5 })), String(copyOf({ price: "x", label: 3 })));
