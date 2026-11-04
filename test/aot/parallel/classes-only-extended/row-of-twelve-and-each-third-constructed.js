class C0 { constructor() { this.v0 = 0; } m() { return 0; } }
class C1 extends C0 { constructor() { super(); this.v1 = 1; } m() { return super.m() + this.v1; } }
class C2 extends C1 { constructor() { super(); this.v2 = 2; } m() { return super.m() + this.v2; } }
class C3 extends C2 { constructor() { super(); this.v3 = 3; } m() { return super.m() + this.v3; } }
class C4 extends C3 { constructor() { super(); this.v4 = 4; } m() { return super.m() + this.v4; } }
class C5 extends C4 { constructor() { super(); this.v5 = 5; } m() { return super.m() + this.v5; } }
class C6 extends C5 { constructor() { super(); this.v6 = 6; } m() { return super.m() + this.v6; } }
class C7 extends C6 { constructor() { super(); this.v7 = 7; } m() { return super.m() + this.v7; } }
class C8 extends C7 { constructor() { super(); this.v8 = 8; } m() { return super.m() + this.v8; } }
class C9 extends C8 { constructor() { super(); this.v9 = 9; } m() { return super.m() + this.v9; } }
class C10 extends C9 { constructor() { super(); this.v10 = 10; } m() { return super.m() + this.v10; } }
class C11 extends C10 { constructor() { super(); this.v11 = 11; } m() { return super.m() + this.v11; } }
class C12 extends C11 { constructor() { super(); this.v12 = 12; } m() { return super.m() + this.v12; } }
for (const o of [new C3(), new C6(), new C9(), new C12()]) console.log(o.m(), Object.keys(o).length, o.constructor.name, o instanceof C6);
