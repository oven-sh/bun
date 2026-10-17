// `Object.entries({ ...sent, 9: "tail" })`, where `sent` is a dictionary by number: TypeScript infers the values' type from the one written member and forgets what the spread brings. What is inferred never decides what the program does.
type Body = string | Uint8Array;
const sent: Record<number, Body> = { 1: new Uint8Array(2), 5: "five" };
const counts: { [index: number]: number | boolean } = { 1: true, 2: 2 };
const row = (name: string, f: () => unknown) => { let r: unknown; try { r = f(); } catch (e) { r = "THROWS " + (e as Error).message.split(" (bun")[0]; } console.log(name + ": " + JSON.stringify(r)); };
row("entries, taken apart in the parameter", () => Object.entries({ ...sent, 9: "tail" }).map(([number, content]) => [number, typeof content]));
row("entries, a parameter", () => Object.entries({ ...sent, 9: "tail" }).map(entry => typeof entry[1]));
row("entries, for..of", () => { const kinds: string[] = []; for (const [, content] of Object.entries({ ...sent, 9: "tail" })) kinds.push(typeof content); return kinds; });
row("values", () => Object.values({ ...sent, 9: "tail" }).map(content => typeof content));
row("values, kept first", () => { const all = Object.values({ ...counts, 9: 9 }); return all.map(n => typeof n); });
row("used as the type says", () => Object.entries({ ...sent, 9: "tail" }).map(([, content]) => content.length));
row("handed on", () => { const size = (text: unknown) => (typeof text === "string" ? text.length : -1); return Object.values({ ...sent, 9: "tail" }).map(content => size(content)); });
row("the spread behind the written member", () => Object.values({ 9: "tail", ...sent }).map(content => typeof content));
row("no spread: a fact as before", () => Object.values({ 1: "a", 9: "tail" }).map(content => content.length));
row("a spread of a literal: known", () => Object.values({ ...{ 1: "a" }, 9: "tail" }).map(content => content.length));
row("a dictionary by string", () => { const named: Record<string, Body> = { a: new Uint8Array(1) }; return Object.values({ ...named, b: "tail" }).map(content => typeof content); });
