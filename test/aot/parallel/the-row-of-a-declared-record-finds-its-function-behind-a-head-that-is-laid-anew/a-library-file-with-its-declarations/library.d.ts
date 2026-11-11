export interface Issue { stops: boolean }
export interface Payload { value: unknown; issues: Issue[] }
export declare const first: <T>(value: T) => T;
export declare function aborted(payload: Payload, start?: number): boolean;
