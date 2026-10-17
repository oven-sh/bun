// A class whose fields are only declared, as one is written once JavaScript has been given types from outside, and whose constructor stores to all of them: more than 128 bytes, and all of them lie in the object itself.
// CALLS- Core CreateTypedFieldOutOfLine
class Core {
  declare f0: (x: number) => number; declare f1: (x: number) => number; declare f2: (x: number) => number; declare f3: (x: number) => number; declare f4: (x: number) => number; declare f5: (x: number) => number; declare f6: (x: number) => number; declare f7: (x: number) => number; declare f8: (x: number) => number; declare f9: (x: number) => number; declare f10: (x: number) => number; declare f11: (x: number) => number; declare f12: (x: number) => number; declare f13: (x: number) => number; declare f14: (x: number) => number; declare f15: (x: number) => number; declare f16: (x: number) => number; declare f17: (x: number) => number; declare f18: (x: number) => number; declare f19: (x: number) => number; declare f20: (x: number) => number; declare f21: (x: number) => number; declare f22: (x: number) => number; declare f23: (x: number) => number; declare o0: unknown; declare o1: unknown; declare o2: unknown; declare o3: unknown; declare o4: unknown; declare o5: unknown; declare o6: unknown; declare o7: unknown; declare o8: unknown; declare o9: unknown; declare o10: unknown; declare o11: unknown;
  constructor(options: Record<string, unknown>) {
    this.f0 = (x: number) => x + 0;
    this.f1 = (x: number) => x + 1;
    this.f2 = (x: number) => x + 2;
    this.f3 = (x: number) => x + 3;
    this.f4 = (x: number) => x + 4;
    this.f5 = (x: number) => x + 5;
    this.f6 = (x: number) => x + 6;
    this.f7 = (x: number) => x + 7;
    this.f8 = (x: number) => x + 8;
    this.f9 = (x: number) => x + 9;
    this.f10 = (x: number) => x + 10;
    this.f11 = (x: number) => x + 11;
    this.f12 = (x: number) => x + 12;
    this.f13 = (x: number) => x + 13;
    this.f14 = (x: number) => x + 14;
    this.f15 = (x: number) => x + 15;
    this.f16 = (x: number) => x + 16;
    this.f17 = (x: number) => x + 17;
    this.f18 = (x: number) => x + 18;
    this.f19 = (x: number) => x + 19;
    this.f20 = (x: number) => x + 20;
    this.f21 = (x: number) => x + 21;
    this.f22 = (x: number) => x + 22;
    this.f23 = (x: number) => x + 23;
    this.o0 = options.o0;
    this.o1 = options.o1;
    this.o2 = options.o2;
    this.o3 = options.o3;
    this.o4 = options.o4;
    this.o5 = options.o5;
    this.o6 = options.o6;
    this.o7 = options.o7;
    this.o8 = options.o8;
    this.o9 = options.o9;
    this.o10 = options.o10;
    this.o11 = options.o11;
  }
}
const options: Record<string, unknown> = {};
for (let i = 0; i < 12; i++) options["o" + i] = i & 1 ? i : "s" + i;
const kept: Core[] = [];
for (let i = 0; i < 30; i++) kept.push(new Core(options));
console.log(kept.length, kept[7].f3(1), kept[7].f23(1), kept[7].o5, kept[7].o10, kept[7].f3 === kept[8].f3, Object.keys(kept[7]).join(), JSON.stringify(kept[7]));
