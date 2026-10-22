// What an await yields is of the type the checker gives it: strings, records, arrays, functions, maps, undefined, null: in straight code, in loops, inside try, after a rejection.

interface User { id: number; name: string; tags: string[]; boss: User | undefined; }
const lines: string[] = [];
function say(...parts: unknown[]) { lines.push(parts.map(part => typeof part === "object" && part !== null ? JSON.stringify(part) : String(part)).join(" ")); }

async function text(id: number): Promise<string> { await null; return "user" + id; }
async function textOrNothing(id: number): Promise<string | undefined | null> { await null; return id % 3 === 0 ? undefined : id % 3 === 1 ? null : "t" + id; }
async function user(id: number): Promise<User> { const name = await text(id); return { id, name, tags: [name], boss: undefined }; }
async function userOrNothing(id: number): Promise<User | undefined> { return id % 2 ? await user(id) : undefined; }
async function list(id: number): Promise<string[]> { return [await text(id), await text(id + 1)]; }
async function table(id: number): Promise<Map<string, number>> { return new Map([[await text(id), id]]); }
async function adder(id: number): Promise<(n: number) => number> { await null; return n => n + id; }
async function fails(id: number): Promise<User> { await null; throw new RangeError("no user " + id); }
function already(id: number): Promise<string> { return Promise.resolve("already" + id); }
function thenable(id: number): PromiseLike<string> { return { then(resolve) { resolve!("then" + id); return this as any; } }; }

class Store {
    private seen = 0;
    async get(id: number): Promise<User> { this.seen++; return await user(id); }
    async count(): Promise<number> { await null; return this.seen; }
}

async function main() {
    const store = new Store();
    say(await text(1), (await text(2)).length);
    for (let i = 0; i < 4; i++) {
        const t = await textOrNothing(i);
        say("text or nothing", t, t?.length, t ?? "none");
        const u = await user(i);
        say("user", u, u.tags.length, u.boss);
        const m = await userOrNothing(i);
        say("maybe", m?.name, m === undefined);
        const l = await list(i);
        say("list", l.join(), l.length);
        const map = await table(i);
        say("table", map.size, map.get("user" + i));
        say("adder", (await adder(i))(10));
        say("store", (await store.get(i)).name, await store.count());
        say("others", await already(i), await thenable(i), await i, await "plain", await undefined);
    }
    for (const id of [1, 2]) {
        try {
            const u = id === 1 ? await user(id) : await fails(id);
            say("inside try", u.name);
        } catch (error) {
            say("caught", (error as Error).name, (error as Error).message);
        } finally {
            say("finally", await text(id));
        }
    }
    const [a, b, c] = await Promise.all([text(7), user(8), list(9)]);
    say("all", a, b.name, c.length);
    const raced = await Promise.race([text(10), text(11)]);
    say("race", raced);
    let total = 0;
    for (let i = 0; i < 300; i++) total += (await text(i)).length + (await user(i)).id;
    say("total", total);
}
main().then(() => console.log(lines.join("\n")));
