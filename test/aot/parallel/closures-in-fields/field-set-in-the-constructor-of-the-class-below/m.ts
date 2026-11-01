export class A { f: () => string = () => "a"; constructor() { this.init(); } init() {} }
export class B extends A { seen = "no"; init() { this.seen = typeof this.f + ":" + this.f(); } }
