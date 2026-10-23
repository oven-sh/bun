// A mapped type nobody checked, for spread-mapped-type.ts.
type Stringify<T> = { [K in keyof T]: string };
