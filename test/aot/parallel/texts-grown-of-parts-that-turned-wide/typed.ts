const count = 20000;
const textOf = (i: number): string => "identifier-number-" + (100000 + i);
const written: string[] = []; for (let i = 0; i < count; i++) written.push(textOf(i));
const wide: string[] = JSON.parse('["' + written.join('","') + '","Ā"]');
const seen: Record<string, number> = Object.create(null); for (const name of wide) seen[name] = 0;
const narrow: string[] = []; for (let i = 0; i < count; i++) narrow.push(textOf(i));
class State { out: string = "names:"; }
const state = new State();
for (let i = 0; i < count; i++) { const name = narrow[i]; state.out += name; seen[name] += 1; }
console.log(state.out.length, state.out.indexOf("\0"), state.out === "names:" + written.join(""));
