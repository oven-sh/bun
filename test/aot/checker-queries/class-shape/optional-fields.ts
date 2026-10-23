// Fields absent at creation are optional: `x?`, `declare x` and `abstract x`, but not an initialized field.
abstract class O {
  a?: number;
  declare b: string;
  abstract c: boolean;
  d: number = 1;
}
