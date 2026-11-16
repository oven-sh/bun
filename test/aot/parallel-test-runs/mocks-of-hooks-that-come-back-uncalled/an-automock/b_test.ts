import { test, vi, jest, mock } from "bun:test";
const say = (n: string, f: () => any) => { try { console.log(n, String(f())); } catch (e: any) { console.log(n, "threw", e.name); } };
import * as S from "./svc.ts";
test("c", () => { say("c", () => (S as any).load()); });
