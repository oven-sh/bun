// A member computed from a member or a template that names a `.d.ts` alias is unwritten: it promises neither `unknown` nor what the `.d.ts` says. The members beside it stay written.
/// <reference path="./declaration-file-alias-derived-member.d.ts" />
interface Settings { port: Port; retries: number }
interface Ports { [name: string]: Port }
declare const settings: Settings;
let a: Partial<Settings>;
let b: Readonly<Ports>;
let c: { [K in keyof Settings]: Port };
const copy = { ...settings };
copy.port;
copy.retries;
let d: typeof copy;
export {};
