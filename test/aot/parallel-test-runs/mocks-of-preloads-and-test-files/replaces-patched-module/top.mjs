export * from './service.mjs';
export { q as again } from './db.mjs';
import { read } from './service.mjs';
export const twice = () => [read(), read()].join();
