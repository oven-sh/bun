class A { m() { return 1; } }
class B extends A { n() { return super.m() + 1; } }
export const read = () => B;
