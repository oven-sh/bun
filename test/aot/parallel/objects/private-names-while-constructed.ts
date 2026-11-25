// `#name in value` in loops that meet finished objects, objects whose fields are still to come, and others.
const lines: string[] = [];
class Parts { static seen: any[] = []; static others: any[] = [{}, [], { a: 1 }];
  #first = Parts.look(this, "first"); #second = Parts.look(this, "second"); third = Parts.look(this, "third");
  static look(o: any, when: string) { Parts.seen.push(o); lines.push(when + " " + Parts.count([...Parts.others, o, ...Parts.seen.slice(0, 2)])); return when; }
  static count(list: any[]) { let r = ""; for (const o of list) r += (#first in o ? "f" : "-") + (#second in o ? "s" : "-"); return r; } }
class Below extends Parts { #own: any = Below.mine(this); static mine(o: any) { let r = ""; for (const x of [{}, o, ...Parts.seen]) r += #own in x ? "o" : "."; lines.push("own " + r); return r; } static all(list: any[]) { let r = ""; for (const x of list) r += #own in x ? "o" : "."; return r; } }
for (let i = 0; i < 3; i++) { new Parts(); new Below(); lines.push(Below.all([...Parts.seen, ...Parts.others])); Parts.seen.length = i ? 4 : Parts.seen.length; }
for (const line of lines) console.log(line);
