Object.defineProperty(console, "toString", { value() { return "SAID " + typeof this.Console; } });
console.log(`${console}`);
