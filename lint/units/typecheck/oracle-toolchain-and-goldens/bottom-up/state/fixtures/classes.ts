declare class Animal {
    legs: number;
    static count: number;
    constructor(legs: number);
    move(distance: number): void;
}
interface Tagged<T> {
    tag: T;
}
declare class Dog<T, U extends T = T> extends Animal implements Tagged<T> {
    tag: T;
    private owner: U;
    get label(): T;
    set label(value: T);
    bark<V>(volume: V): this;
    static create(): Dog<string>;
}
declare abstract class Shape {
    abstract area(): number;
    protected constructor();
}
