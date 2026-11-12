import { expect, jest, mock, test, vi } from "bun:test";
test("one", async () => {
  vi.doMock("./x", () => ({ f: () => "mock f", mark: "mock" }));
  const tell = async (name: string, deed: () => any) => { try { const v = await deed(); console.log("SAID", name, typeof v === "function" ? "fn" : typeof v === "object" && v ? JSON.stringify(v) : String(v)); } catch (e: any) { console.log("SAID", name, "threw", e.name, String(e.message).split("\n")[0]); } };
  let real: any; await tell("original", async () => { real = await vi.importActual("./x"); return Object.keys(real).join(); });
  const { go } = await import("./user").catch((e: any) => ({ go: () => "no user " + e.name }));
  await tell("user", () => go());
  if (real) {
    for (const k of Object.keys(real)) await tell(k, async () => typeof real[k] === "function" && !String(real[k]).startsWith("class") && k !== "gen" ? real[k]([]) : real[k]);
    await tell("f again", () => real.f());
    await tell("user again", () => go());
    await tell("same", async () => (await vi.importActual("./x")) === real);
    await tell("descriptor", () => { const d = Object.getOwnPropertyDescriptor(real, "f")!; return [d.writable, d.enumerable, d.configurable, typeof d.value].join(); });
    await tell("tag", () => Object.prototype.toString.call(real) + ("f" in real) + ("nothing" in real) + Object.isExtensible(real) + Reflect.ownKeys(real).length);
    await tell("write", () => { real.f = 1; return "wrote"; });
    await tell("delete", () => { delete real.nothing; return Reflect.deleteProperty(real, "f"); });
    await tell("spied", async () => { const s = vi.spyOn(real, "f").mockReturnValue("spied" as any); const r = [await real.f(), s.mock.calls.length]; s.mockRestore(); return r.join() + typeof real.f; });
    await tell("equal", () => expect({ ...real }).toEqual(expect.objectContaining({})));
  }
});
test("after", async () => {
  vi.doUnmock("./x");
  const x: any = await import("./x").catch((e: any) => ({ e: e.name }));
  console.log("SAID unmocked", Object.keys(x).join(), typeof x.f);
});
