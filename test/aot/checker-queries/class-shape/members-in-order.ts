// A class lists its parameter properties first, then its members in source order; a plain parameter adds no member.
class C {
  x: number = 1;
  constructor(public a: number, private b: string, c: boolean) {}
  static s: string = "s";
  #p: number = 2;
  m(): void {}
  get g(): number { return 1; }
  set g(v: number) {}
}
