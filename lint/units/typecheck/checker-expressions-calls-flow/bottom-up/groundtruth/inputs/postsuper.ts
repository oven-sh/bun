class B0 { x = 1 }
class D0 extends B0 {
  constructor(n: number) {
    if (n) { super(); return; }
    throw 1;
    while (this.x) { }
    super();
  }
}
class D1 extends B0 { constructor() { this.x; super(); this.x; } }
class D2 extends B0 { constructor(n: number) { if (n) super(); else super(); this.x; } }
class D3 extends B0 { constructor(n: number) { for (;;) { if (n) break; } this.x; super(); } }
