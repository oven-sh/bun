// An async frame is placed at the last call or member that its awaited expression evaluates.
async function later(..._: unknown[]): Promise<any> {
  await 0;
  throw new Error("later");
}
const box: any = {
  later,
  same: async (value: unknown) => value,
  count: (value: number) => value,
  inner: { later, deep: { later } },
};
Object.defineProperty(box, "waiting", { get: () => later() });
Object.defineProperty(box.inner, "waiting", { get: () => later() });
const table: any = { later };
const key = "lat" + "er";
const flag: any = globalThis.process.argv.length;
const missing: any = flag > 1000 ? box : undefined;

const probes: Record<string, () => Promise<unknown>> = {
  async name() {
    await later(1);
  },
  async member() {
    await box.later(1);
  },
  async deepMember() {
    await box.inner.deep.later(1);
  },
  async getter() {
    await box.waiting;
  },
  async deepGetter() {
    await box.inner.waiting;
  },
  async variable() {
    const waiting = later(1);
    await waiting;
  },
  async stringKey() {
    await table["later"](1);
  },
  async computedKey() {
    await box[key](1);
  },
  async optionalMember() {
    await box?.later(1);
  },
  async optionalCall() {
    await box.later?.(1);
  },
  async argumentsThatCall() {
    await box.later(box.count(1), box.count(2));
  },
  async callOfResult() {
    await later.bind(null)(1);
  },
  async lines() {
    await box
      .inner
      .later(
        1,
      );
  },
  async all() {
    await Promise.all([later(1), box.later(2)]);
  },
  async conditional() {
    await (flag ? box.inner.later(1) : box.later(2));
  },
  async logical() {
    await (missing || box.later(1));
  },
  async nullish() {
    await (missing?.later(1) ?? box.later(1));
  },
  async comma() {
    await (box.count(1), box.later(1));
  },
  async assertion() {
    await (box!.later(1) as Promise<unknown>);
  },
  async awaitedArgument() {
    await later(await box.same(1));
  },
  async argument() {
    box.count(await box.later(1));
  },
  async twice() {
    await (await box.later(1));
  },
  async pattern() {
    const { a } = await box.later(1);
    return a;
  },
  async returned() {
    return await box.later(1);
  },
  async test() {
    if (await box.later(1)) return 1;
  },
  async list() {
    for (const value of await box.later(1)) return value;
  },
  async guarded() {
    try {
      await box.later(1);
    } finally {
      box.count(1);
    }
  },
};

for (const name in probes) {
  try {
    await probes[name]();
  } catch (error) {
    const frames = String((error as Error).stack).split("\n");
    console.log(name, frames.filter(line => line.includes("at async ")).map(line => line.match(/:(\d+:\d+)\)?$/)![1])[0]);
  }
}
