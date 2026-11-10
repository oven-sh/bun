import { mock, test, vi } from "bun:test";
// Twenty files take turns: each mock has ended and nobody was linked under it when the next file's is laid. The last mock of a file waits until the file is asked for again.
const rounds = [
  async load => {
    vi.doMock("./shelf0.mjs", () => ({ load }));
    await import("./shelf0.mjs");
    vi.doUnmock("./shelf0.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf1.mjs", () => ({ load }));
    await import("./shelf1.mjs");
    vi.doUnmock("./shelf1.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf2.mjs", () => ({ load }));
    await import("./shelf2.mjs");
    vi.doUnmock("./shelf2.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf3.mjs", () => ({ load }));
    await import("./shelf3.mjs");
    vi.doUnmock("./shelf3.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf4.mjs", () => ({ load }));
    await import("./shelf4.mjs");
    vi.doUnmock("./shelf4.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf5.mjs", () => ({ load }));
    await import("./shelf5.mjs");
    vi.doUnmock("./shelf5.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf6.mjs", () => ({ load }));
    await import("./shelf6.mjs");
    vi.doUnmock("./shelf6.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf7.mjs", () => ({ load }));
    await import("./shelf7.mjs");
    vi.doUnmock("./shelf7.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf8.mjs", () => ({ load }));
    await import("./shelf8.mjs");
    vi.doUnmock("./shelf8.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf9.mjs", () => ({ load }));
    await import("./shelf9.mjs");
    vi.doUnmock("./shelf9.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf10.mjs", () => ({ load }));
    await import("./shelf10.mjs");
    vi.doUnmock("./shelf10.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf11.mjs", () => ({ load }));
    await import("./shelf11.mjs");
    vi.doUnmock("./shelf11.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf12.mjs", () => ({ load }));
    await import("./shelf12.mjs");
    vi.doUnmock("./shelf12.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf13.mjs", () => ({ load }));
    await import("./shelf13.mjs");
    vi.doUnmock("./shelf13.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf14.mjs", () => ({ load }));
    await import("./shelf14.mjs");
    vi.doUnmock("./shelf14.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf15.mjs", () => ({ load }));
    await import("./shelf15.mjs");
    vi.doUnmock("./shelf15.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf16.mjs", () => ({ load }));
    await import("./shelf16.mjs");
    vi.doUnmock("./shelf16.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf17.mjs", () => ({ load }));
    await import("./shelf17.mjs");
    vi.doUnmock("./shelf17.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf18.mjs", () => ({ load }));
    await import("./shelf18.mjs");
    vi.doUnmock("./shelf18.mjs");
    vi.resetModules();
  },
  async load => {
    vi.doMock("./shelf19.mjs", () => ({ load }));
    await import("./shelf19.mjs");
    vi.doUnmock("./shelf19.mjs");
    vi.resetModules();
  },
];
test("the end", async () => {
  const refs = [];
  const one = async (round, turn) => {
    const load = new Array(1000).fill(turn);
    refs.push(new WeakRef(load));
    await round(load);
  };
  for (let turn = 0; turn < 6; turn++) for (const round of rounds) await one(round, turn);
  for (let i = 0; i < 5; i++) {
    Bun.gc(true);
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  console.log("SAID behind resets", refs.length, refs.filter(ref => ref.deref() !== undefined).length <= 30 ? "few" : "many");
}, 60000);
