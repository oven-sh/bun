// A power of two written numbers is one number wherever it stands: what the build computes ahead (an enum member, a template literal, the left of `||`) is what the engine computes when the program runs, to the last digit, as in plain Bun.
const unknown = <T,>(x: T): T => x;
const shown = (value: unknown): string => (typeof value === "number" ? value.toPrecision(17) : String(value));
enum Big { A = 3 ** 100, B = 5 ** 33, C = A * 1, D = 7 ** 0.5, E = 2147483647 ** 0.1, F = 10 ** -5, G = 1.1 ** 1001, H = (-8) ** 3, I = 2 ** -0.5 }
const enum Inlined { A = 3 ** 100, B = 9 ** 77 }
console.log("enum members", shown(Big.A), shown(Big.B), shown(Big.C), shown(Big.D), shown(Big.E), shown(Big.F), shown(Big.G), shown(Big.H), shown(Big.I));
console.log("at run time ", shown(unknown(3) ** unknown(100)), shown(unknown(5) ** unknown(33)), shown(unknown(3) ** unknown(100) * 1), shown(unknown(7) ** unknown(0.5)), shown(unknown(2147483647) ** unknown(0.1)), shown(unknown(10) ** unknown(-5)), shown(unknown(1.1) ** unknown(1001)), shown(unknown(-8) ** unknown(3)), shown(unknown(2) ** unknown(-0.5)));
console.log("const enums ", shown(Inlined.A), shown(Inlined.B), Inlined.B === unknown(9) ** unknown(77));
console.log("the same    ", Big.A === 3 ** 100, Big.A === unknown(3) ** unknown(100), Big[Big.A], Math.pow(3, 100) === Big.A);
console.log("templates   ", `${3 ** 100}`, `${5 ** 33}`, `${2147483647 ** 0.1}`);
console.log("left of ||  ", shown((3 ** 100) || "s"), shown((5 ** 33) || "s"), shown((2147483647 ** 0.1) || "s"));
console.log("edges       ", shown((1 ** Infinity) || "s"), shown(((-1) ** -Infinity) || "s"), shown((0 ** 0.5) || "s"), shown((0 ** -0.5) || "s"), shown((Infinity ** -0.5) || "s"), shown((2 ** NaN) || "s"), shown((NaN ** 0) || "s"), shown((2 ** 1024) || "s"));
