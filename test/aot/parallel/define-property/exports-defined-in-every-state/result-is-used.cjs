const same = Object.defineProperty(exports, "a", { value: 1, enumerable: true });
Object.defineProperty(same, "b", { value: same === exports, enumerable: true }).c = 3;
Object.defineProperty(Object.defineProperty(exports, "d", { value: 4 }), "e", { get() { return 5; }, enumerable: true });
