import { Kind } from "./kinds";
export function read(): unknown { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return Kind.valueOf; }
export function own(): boolean { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return Object.hasOwn(Kind, "valueOf"); }
