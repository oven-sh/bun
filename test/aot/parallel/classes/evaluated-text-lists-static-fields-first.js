// A for-in in evaluated text is the first to look at a class. It lists the static fields of the class and of the classes above it, the first time as every later time.
const say = (...values) => console.log(...values);
const list = new Function("c", "const names = []; for (const name in c) names.push(name); return names.join()" + (process.env.NOBODY_HAS_SET_THIS ?? ""));

class None {}
class One { static extra = 1; static method() {} }
class Two { static first = 1; static second = 2; }
say([list(None)], [list(One)], [list(One)], [list(Two)], [list(Two)]);

class Above { static above = 1; }
class BelowWithout extends Above {}
class BelowWith extends Above { static below = 2; }
say([list(BelowWithout)], [list(BelowWith)], [list(BelowWith)], [list(Above)]);

class Stored { static kept = 1; }
Stored.added = 2;
say([list(Stored)]);
class Removed { static gone = 1; static stays = 2; }
delete Removed.gone;
say([list(Removed)]);
class Hidden { static seen = 1; static unseen = 2; }
Object.defineProperty(Hidden, "unseen", { enumerable: false });
say([list(Hidden)]);
class ReadInTheLoop { static a = "A"; static b = "B"; }
say(new Function("c", "let text = ''; for (const name in c) text += name + c[name]; return text" + (process.env.NOBODY_HAS_SET_THIS ?? ""))(ReadInTheLoop));
