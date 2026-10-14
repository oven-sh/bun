export type Deep<T> = T extends (infer U)[] ? readonly Deep<U>[] : T extends Function ? T : T extends object ? { readonly [K in keyof T]: Deep<T[K]> } : T;
