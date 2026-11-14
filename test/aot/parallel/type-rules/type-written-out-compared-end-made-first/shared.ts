export interface Box<T> { v: T; next: Box<[T]> | null }
export interface Crate<T> { v: T extends [[[infer _]]] ? string : T; next: Crate<[T]> | null }
