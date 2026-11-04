export class A { static s() { return "a"; } }
class B extends A {}
export const read = () => B;
