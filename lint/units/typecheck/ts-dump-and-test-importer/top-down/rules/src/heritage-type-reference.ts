namespace N { export interface A {} export class B {} }
interface X extends N.A, Array<string> {}
class Y extends N.B implements N.A, X {}
class Z extends (N.B) implements Partial<X> {}
