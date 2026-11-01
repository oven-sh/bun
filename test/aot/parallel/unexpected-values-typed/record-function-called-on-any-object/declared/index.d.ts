export declare const pass: any;
export declare function put(target: any, key: string, value: unknown): void;
export declare function attempt(act: () => unknown): string;
export declare class Part {
  [member: string]: any;
}
export type Holder = { id: number; part: Part };
export declare function walk(holder: Holder, turns: number): string;
export declare const record: any;
export declare const holder: Holder;
export declare class Other {
  [member: string]: any;
}
export declare const otherHolder: { id: number; part: Other };
