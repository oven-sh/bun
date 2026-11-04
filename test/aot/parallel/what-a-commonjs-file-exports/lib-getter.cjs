let asked = 0;
Object.defineProperty(module, "exports", { configurable: true, get() { asked++; return function got() { return "got " + asked; }; } });
