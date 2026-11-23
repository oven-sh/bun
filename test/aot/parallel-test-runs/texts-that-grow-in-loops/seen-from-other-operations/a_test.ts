import { expect, test } from "bun:test";
const unseen = (0, eval)("(x) => x") as <T>(x: T) => T;
const hidden = unseen(function (a: unknown, b: unknown): string { return a + ":" + b; });
function lists(count: number): string {
  const kept: string[] = [];
  let line = "";
  for (let i = 0; i < count; i++) {
    const got = hidden.apply(null, [line, i]);
    line += "k" + i;
    kept.push(got);
  }
  return line + "/" + kept.join("|");
}
function names(count: number): string {
  const kept: unknown[] = [];
  let line = "";
  for (let i = 0; i < count; i++) {
    const got = new URLSearchParams(line + "=1&k0=2").get(line);
    line += "k" + i;
    kept.push(got);
  }
  return line + "/" + kept.join("|");
}
function addresses(count: number): string {
  const kept: unknown[] = [];
  let line = "http://a.example/p?a=0";
  for (let i = 0; i < count; i++) {
    const url = new URL(line);
    line += "&k" + i + "=%2" + i;
    kept.push(url.searchParams.get("k0"), url.search.length);
  }
  return kept.join("|");
}
function promises(count: number): Promise<unknown>[] {
  const pending: Promise<unknown>[] = [];
  let line = "";
  for (let i = 0; i < count; i++) {
    const list = [line, i];
    pending.push(Promise.all([line, i]));
    line += "k" + i;
    pending.push(Promise.all(list));
  }
  return pending;
}
test("a list written for apply holds the text as it was", () => {
  let last = "";
  for (let turn = 0; turn < 300; turn++) last = lists(unseen(3));
  expect(last).toBe("k0k1k2/:0|k0:1|k0k1:2");
});
test("the name asked of search params is the text as it is", () => {
  let last = "";
  for (let turn = 0; turn < 300; turn++) last = names(unseen(3));
  expect(last).toBe("k0k1k2/1|1|1");
});
test("a URL holds the text as it was", () => {
  let last = "";
  for (let turn = 0; turn < 300; turn++) last = addresses(unseen(3));
  expect(last).toBe("|4| |11| |18");
});
test("a list handed to Promise.all holds the text as it was", async () => {
  let last = "";
  for (let turn = 0; turn < 300; turn++) last = (await Promise.all(promises(unseen(2)))).join("|");
  console.log(last);
  expect(last).toBe(",0|,0|k0,1|k0,1");
});
