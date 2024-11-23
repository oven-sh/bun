// eslint-disable-next-line @definitelytyped/no-unnecessary-generics
export declare const expectType: <T>(expression: T) => void;
// eslint-disable-next-line @definitelytyped/no-unnecessary-generics
export declare const expectAssignable: <T>(expression: T) => void;
// eslint-disable-next-line @definitelytyped/no-unnecessary-generics
export declare const expectNotAssignable: <T>(expression: any) => void;
// eslint-disable-next-line @definitelytyped/no-unnecessary-generics
export declare const expectTypeEquals: <T, S>(expression: T extends S ? (S extends T ? true : false) : false) => void;

type IsAny<T> = 0 extends 1 & T ? true : false;
type IsNever<T> = [T] extends [never] ? true : false;
type OnlyAny<T> = IsNever<T> extends true ? [] : IsAny<T> extends true ? [T] : never;

// eslint-disable-next-line @definitelytyped/no-unnecessary-generics
export declare function expectAny<T>(...value: OnlyAny<T>): void;
