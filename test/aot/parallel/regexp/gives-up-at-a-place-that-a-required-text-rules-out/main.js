// Every match of these patterns holds a #, and none can begin in front of the [. An attempt at the first place still runs out of turns, so there is no match.
const nothing = String(Date.now()).slice(99);
const text = "a".repeat(26) + "[#";
console.log(JSON.stringify(/(?:\w+?)*#/.exec(text)));
console.log(JSON.stringify(/(?:\w+)*#/.exec(text)));
console.log(JSON.stringify(new RegExp("(?:\\w+?)x*#" + nothing).exec(text)));
console.log(JSON.stringify(new RegExp("(?:(?:\\w)+)*#" + nothing).exec(text)));
const near = "a".repeat(24) + "[#";
console.log(JSON.stringify(/(?:\w+?)*#/.exec(near)));
console.log(JSON.stringify(new RegExp("(?:(?:\\w)+)*#" + nothing).exec(near)));
console.log(JSON.stringify(/(?:\w+)*#/.exec("no sign of it".repeat(4))));
console.log(JSON.stringify(/(?:[a-z]+)*$/.exec("a".repeat(26) + "[")));
