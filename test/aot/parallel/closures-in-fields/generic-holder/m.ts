export class Box<T> { constructor(public value: T) {} }
export const boxes = () => [new Box(() => 1), new Box(2), new Box("t"), new Box(() => 4)] as Box<unknown>[];
