// An error quotes what Bun's transpiler prints. `Color.Green` is printed `1 /* Green */`, and the comment is quoted with it unless the expression ends there.
// `"a" in (await o)` is printed `"a" in await o`; `(await o).b` and `(await o)()` keep their brackets.
enum Color { Red, Green, Blue }
const enum Size { Small = 3, Large = "large", Odd = "a-b", Below = -1, Half = 0.5, Huge = 10000 }
enum Both { First = 1, Second = First + 1, Text = "t" }
const list: any[] = [];
const table: any = {};
function say(run: () => unknown) { try { run(); } catch (error: any) { console.log(error.message); } }
say(() => list[Color.Green].x);
say(() => list[Color.Green]());
say(() => table[Size.Large].x);
say(() => table[Size.Odd].x);
say(() => table[Size.Odd]());
say(() => list[Size.Small].x.y);
say(() => list[Size.Below].x);
say(() => list[Size.Half].x);
say(() => list[Size.Huge].x);
say(() => list[Size.Huge]());
say(() => list[10000]());
say(() => table.a[Color.Blue]);
say(() => new list[Color.Red]());
say(() => list[Color["Green"]].x);
say(() => list[Both.Second].x);
say(() => (Color.Green as any)());
say(() => (Both.Text as any)());
say(() => (Color.Green as any).x.y);
say(() => (Both.Text as any).x.y);
say(() => table.f(Color.Green, Size.Odd));
say(() => list[Color.Green + 1].x);
say(() => { const green = Color.Green; return list[green].x; });
say(() => table[Color[Color.Green]].x);
say(() => "a" in (Color.Green as any));
say(() => delete list[Color.Green].x);
say(() => { list[Color.Green].x = 1; });
say(() => { list[Color.Green].x++; });
say(() => list[Color.Green]?.x.y.z ?? table.q[Color.Red]);

const o: any = Promise.resolve(5);
const t: any = { p: Promise.resolve(null), f() { return o; } };
async function sayLater(run: () => Promise<unknown>) { try { await run(); } catch (error: any) { console.log(error.message); } }
await sayLater(async () => "a" in (await o));
await sayLater(async () => "a" in (await t.p));
await sayLater(async () => "a" in (await t.f()));
await sayLater(async () => ("a" in (await o)) ? 1 : 2);
await sayLater(async () => "a" in ((await o) as any));
await sayLater(async () => "a" in (((await o))));
await sayLater(async () => "a" in (typeof o as any));
await sayLater(async () => "a" in (void o as any));
await sayLater(async () => "a" in (delete t.q as any));
await sayLater(async () => (await o).b.c);
await sayLater(async () => ((await o) as any).b.c);
await sayLater(async () => (((await o))).b.c);
await sayLater(async () => (await t.p).x);
await sayLater(async () => (await t.p)[0]);
await sayLater(async () => ((await t.p))[0]);
await sayLater(async () => (await o)());
await sayLater(async () => (await o)(1, 2));
await sayLater(async () => (await (await o))());
await sayLater(async () => (await t.p).x());
await sayLater(async () => (await o).b());
await sayLater(async () => (await t.f()).b.c());
await sayLater(async () => new (await o)());
await sayLater(async () => new (await t.p)());
await sayLater(async () => t.missing((await o)));
await sayLater(async () => t.missing((await o), (typeof o)));
await sayLater(async () => t.missing(((await o)), 1));
await sayLater(async () => t.missing[(await o)].x);
