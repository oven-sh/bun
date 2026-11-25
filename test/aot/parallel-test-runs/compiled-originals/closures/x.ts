console.log("SAID body");
const all: (() => number)[] = [];
for (let i = 0; i < 3; i++) all.push(() => i);
{ let hidden = 1; var bump = () => ++hidden; }
try { throw new Error("e"); } catch (e) { var caught = (e as Error).message; }
switch (1) { case 1: let s = 4; var read = () => s++; }
export const f = () => all.map(a => a()).join("") + bump() + caught + read();
export function* gen() { let j = 0; while (j < 2) yield j++; }
export async function later() { await null; return bump(); }
export const tagged = (s: TemplateStringsArray) => s;
export const same = () => tagged`a` === tagged`a`;
