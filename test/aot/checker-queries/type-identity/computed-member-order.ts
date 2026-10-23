// No declaration orders the members of a computed object type, and its layout lists them by key, so two orders are one identity. Other members are another identity.
declare const a: { skipped: boolean; x: number; y: string };
declare const b: { skipped: boolean; y: string; x: number };
const { skipped: s1, ...first } = a;
const { skipped: s2, ...second } = b;
const { y: s3, ...other } = a;
let v1: typeof first;
let v2: typeof second;
let v3: typeof other;
export {};
