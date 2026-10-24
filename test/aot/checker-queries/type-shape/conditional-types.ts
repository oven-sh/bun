// A deferred conditional type is a type variable. Its constraint is what the checker computes, except where evaluating the type can come back to the type itself.
type Wrap<T> = { value: T };
type Plain<T> = T extends string ? "text" : 0;
type Nest<N extends number, Acc = never, Count extends 1[] = []> = N extends Count["length"] ? Acc : Nest<N, Wrap<Acc>, [...Count, 1]>;
type Ping<T, Count extends 1[] = []> = T extends Count["length"] ? Count : Pong<T, [...Count, 1]>;
type Pong<T, Count extends 1[]> = T extends Count["length"] ? Count : Ping<T, [...Count, 1]>;
type Deep<T> = T extends object ? { [K in keyof T]: Deep<T[K]> } : 0;
function plain<T>(value: Plain<T>) {}
function nest<N extends number>(value: Nest<N>, keys: keyof Nest<N>) {}
function ping<T extends number>(value: Ping<T>) {}
function deep<T>(value: Deep<T>) {}
export {};
