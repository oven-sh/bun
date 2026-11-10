import { name, peek } from "./part";
(globalThis.order ??= []).push("user");
export const sees = () => [name, peek()];
