import { mock, test, vi, jest } from "bun:test";
var calls = 0;
const seen: string[] = [];
const shorten = (error: any) => "! " + String(error.message).slice(0, 22);
const ask = (name: string, get: () => any) => { try { seen.push(name + " " + get().v); } catch (error) { seen.push(name + " " + shorten(error)); } };
const wait = async (name: string, get: () => Promise<any>) => { try { seen.push(name + " " + (await get()).v); } catch (error) { seen.push(name + " " + shorten(error)); } };
const say = () => console.log("> " + seen.join("; ") + " calls " + calls + " ran " + String((globalThis as any).ran));
console.log("> " + "TOLD");
vi.mock("./tint", { spy: true });
test("t", async () => {
  await wait("pot", async () => ({ v: (await import("./potter") as any).pot() }));
  (globalThis as any).ready = true;
  vi.doMock("./tint", () => ({ tint: () => "red", isOn: false }));
  await wait("glaze", async () => ({ v: (await import("./glaze") as any).glaze() }));
  await wait("direct", async () => { const it: any = await import("./tint"); return { v: typeof it.tint + " " + it.isOn }; });
  say();
});
