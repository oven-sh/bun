function outer(this: { tag: string }, n: number) {
  const who = async () => this.tag;
  const count = async (...xs: number[]) => arguments.length + xs.length;
  const down = async (k: number): Promise<number> => (k <= 0 ? 0 : 1 + (await down(k - 1)));
  async function* stream(k: number) { for (let i = 0; i < k; i++) yield i + (await down(i)); }
  const collect = async () => { const got: number[] = []; for await (const v of stream(n)) got.push(v); return got.join(""); };
  const returned = async () => { try { return failing(); } catch { return "caught"; } };
  const awaited = async () => { try { return await failing(); } catch { return "caught"; } };
  const failing = async (): Promise<string> => { throw new Error("no"); };
  return Promise.all([who(), count(1, 2), down(n), collect(), returned().catch(() => "escaped"), awaited()]);
}
outer.call({ tag: "t" }, 3).then(all => console.log(all.join(",")));
