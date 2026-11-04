// One list a program, one road a program: the text of a list is asked for by list.toString(), String(list), a template, a sum, and as an element of another list. Made by staging/the-text-of-a-list-1/make-family-of-lists.py.
const said: string[] = [];
const brief = (text: unknown) => typeof text !== "string" ? typeof text + " " + String(text) : text.length > 120 ? text.length + ":" + text.slice(0, 40) + ".." + text.slice(-40) : JSON.stringify(text);
function textOf(list: any) { return `${list}`; }
function textOfList(list: unknown[]) { return `${list}`; }
(globalThis as any).kept = [textOf, textOfList];
for (const ask of [textOf, textOfList, textOf]) {
  try { said.push(brief(ask((() => { const l: any = [1, 2]; Object.setPrototypeOf(l, null); return l; })()))); } catch (error) { said.push((error as Error).constructor.name); }
}
console.log(said.join(" | "));
