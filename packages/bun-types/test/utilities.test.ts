// eslint-disable-next-line @definitelytyped/no-unnecessary-generics
export declare const expectType: <T>(expression: T) => void;
// eslint-disable-next-line @definitelytyped/no-unnecessary-generics
export declare const expectAssignable: <T>(expression: T) => void;
// eslint-disable-next-line @definitelytyped/no-unnecessary-generics
export declare const expectNotAssignable: <T>(expression: any) => void;
// eslint-disable-next-line @definitelytyped/no-unnecessary-generics
export declare const expectTypeEquals: <T, S>(expression: T extends S ? (S extends T ? true : false) : false) => void;
