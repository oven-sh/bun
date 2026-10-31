import { version } from './barrel1';
console.log(version);
console.log(((globalThis as any).ran ?? []).join(' '));
