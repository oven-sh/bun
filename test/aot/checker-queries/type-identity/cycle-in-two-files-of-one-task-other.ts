// Two object types that are each other's type argument, imported by cycle-in-two-files-of-one-task.ts.
export interface A<T> { v: T }
export interface B<T> { w: T }
export type First = A<Second>;
export type Second = B<First>;
let first: First;
let second: Second;
