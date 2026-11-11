const form = new FormData();
form.append("a", new File(["x"], "x.txt"));
form.append("b", "text");
for (const value of form.values()) { try { console.log(value.toUpperCase()); } catch (error) { console.log((error as Error).constructor.name); } }
for (const [key, value] of form.entries()) console.log(key, typeof value, value.length);
function shout(text: string): string { return text + "!"; }
for (const value of form.values()) console.log(typeof shout(value), String(shout(value)).length > 1);
