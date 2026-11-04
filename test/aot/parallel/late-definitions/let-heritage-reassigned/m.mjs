class A1 { who() { return "first"; } }
class A2 { who() { return "second"; } }
let Base = A1;
export const swap = () => { Base = A2; };
class B extends Base {}
export const read = () => B;
