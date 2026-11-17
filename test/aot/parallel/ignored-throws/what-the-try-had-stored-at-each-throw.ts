// several throws lead to one catch that ignores them. The catch reads a variable, a field and a list as each throw left them
class Box { value = "start"; }
function subject(stop: number, box: Box, list: string[]) { let at = "start"; try { at = "one"; box.value = "one"; list.push("one"); if (stop === 1) throw new Error("1"); at = "two"; box.value = "two"; list.push("two"); if (stop === 2) throw new Error("2"); at = "three"; box.value = "three"; if (stop === 3) throw "3"; list.push("three"); } catch { return "caught " + at + " " + box.value + " " + list.join(); } return "done " + at + " " + box.value + " " + list.join(); }
function deed(stop: number) { return subject(stop, new Box(), []); }
for (let stop = 0; stop < 5; stop++) console.log(deed(stop));
let text = "";
for (let i = 0; i < 8; i++) text += deed(i & 3) + "|";
console.log(text);
