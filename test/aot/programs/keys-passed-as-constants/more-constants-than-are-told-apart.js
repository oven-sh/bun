// One call site may pass any of twelve constants, and one emitter has a hundred names.
function Emitter() {
  this.events = Object.create(null);
}
Emitter.prototype.on = function (type, listener) {
  this.events[type] = listener;
  return this;
};
Emitter.prototype.emit = function (type, a, b) {
  const handler = this.events[type];
  if (handler === undefined) return false;
  handler.call(this, a, b);
  return true;
};
class Request {
  constructor(url) {
    this.url = url;
    this.method = "GET";
  }
}
class Response {
  constructor() {
    this.status = 200;
    this.body = "";
  }
}
class Failure {
  constructor(code) {
    this.code = code;
  }
}
const lines = [];
function describe(value) {
  if (value === undefined) return "undefined";
  if (value instanceof Request) return "Request " + value.method + " " + value.url;
  if (value instanceof Response) return "Response " + value.status;
  if (value instanceof Failure) return "Failure " + value.code;
  return typeof value + " " + String(value);
}
function listen(emitter) {
  emitter.on("request", function (req, res) {
    lines.push("request: " + describe(req) + ", " + describe(res));
  });
  emitter.on("failure", function (failure) {
    lines.push("failure: " + describe(failure));
  });
  emitter.on("tick", function (count) {
    lines.push("tick: " + describe(count));
  });
}
const server = new Emitter();
listen(server);
function pick(i) {
  switch (i % 12) {
    case 0: return "request";
    case 1: return "failure";
    case 2: return "tick";
    case 3: return "n3";
    case 4: return "n4";
    case 5: return "n5";
    case 6: return "n6";
    case 7: return "n7";
    case 8: return "n8";
    case 9: return "n9";
    case 10: return "n10";
    default: return "n11";
  }
}
for (let i = 3; i < 12; i++) server.on(pick(i), a => lines.push(pick(i) + ": " + describe(a)));
for (let i = 0; i < 12; i++) server.emit(pick(i + process.argv.length - process.argv.length), i % 2 ? new Failure(i) : i);
const wide = new Emitter();
wide.on("name0", a => lines.push("name0: " + describe(a)));
wide.on("name1", a => lines.push("name1: " + describe(a)));
wide.on("name2", a => lines.push("name2: " + describe(a)));
wide.on("name3", a => lines.push("name3: " + describe(a)));
wide.on("name4", a => lines.push("name4: " + describe(a)));
wide.on("name5", a => lines.push("name5: " + describe(a)));
wide.on("name6", a => lines.push("name6: " + describe(a)));
wide.on("name7", a => lines.push("name7: " + describe(a)));
wide.on("name8", a => lines.push("name8: " + describe(a)));
wide.on("name9", a => lines.push("name9: " + describe(a)));
wide.on("name10", a => lines.push("name10: " + describe(a)));
wide.on("name11", a => lines.push("name11: " + describe(a)));
wide.on("name12", a => lines.push("name12: " + describe(a)));
wide.on("name13", a => lines.push("name13: " + describe(a)));
wide.on("name14", a => lines.push("name14: " + describe(a)));
wide.on("name15", a => lines.push("name15: " + describe(a)));
wide.on("name16", a => lines.push("name16: " + describe(a)));
wide.on("name17", a => lines.push("name17: " + describe(a)));
wide.on("name18", a => lines.push("name18: " + describe(a)));
wide.on("name19", a => lines.push("name19: " + describe(a)));
wide.on("name20", a => lines.push("name20: " + describe(a)));
wide.on("name21", a => lines.push("name21: " + describe(a)));
wide.on("name22", a => lines.push("name22: " + describe(a)));
wide.on("name23", a => lines.push("name23: " + describe(a)));
wide.on("name24", a => lines.push("name24: " + describe(a)));
wide.on("name25", a => lines.push("name25: " + describe(a)));
wide.on("name26", a => lines.push("name26: " + describe(a)));
wide.on("name27", a => lines.push("name27: " + describe(a)));
wide.on("name28", a => lines.push("name28: " + describe(a)));
wide.on("name29", a => lines.push("name29: " + describe(a)));
wide.on("name30", a => lines.push("name30: " + describe(a)));
wide.on("name31", a => lines.push("name31: " + describe(a)));
wide.on("name32", a => lines.push("name32: " + describe(a)));
wide.on("name33", a => lines.push("name33: " + describe(a)));
wide.on("name34", a => lines.push("name34: " + describe(a)));
wide.on("name35", a => lines.push("name35: " + describe(a)));
wide.on("name36", a => lines.push("name36: " + describe(a)));
wide.on("name37", a => lines.push("name37: " + describe(a)));
wide.on("name38", a => lines.push("name38: " + describe(a)));
wide.on("name39", a => lines.push("name39: " + describe(a)));
wide.on("name40", a => lines.push("name40: " + describe(a)));
wide.on("name41", a => lines.push("name41: " + describe(a)));
wide.on("name42", a => lines.push("name42: " + describe(a)));
wide.on("name43", a => lines.push("name43: " + describe(a)));
wide.on("name44", a => lines.push("name44: " + describe(a)));
wide.on("name45", a => lines.push("name45: " + describe(a)));
wide.on("name46", a => lines.push("name46: " + describe(a)));
wide.on("name47", a => lines.push("name47: " + describe(a)));
wide.on("name48", a => lines.push("name48: " + describe(a)));
wide.on("name49", a => lines.push("name49: " + describe(a)));
wide.on("name50", a => lines.push("name50: " + describe(a)));
wide.on("name51", a => lines.push("name51: " + describe(a)));
wide.on("name52", a => lines.push("name52: " + describe(a)));
wide.on("name53", a => lines.push("name53: " + describe(a)));
wide.on("name54", a => lines.push("name54: " + describe(a)));
wide.on("name55", a => lines.push("name55: " + describe(a)));
wide.on("name56", a => lines.push("name56: " + describe(a)));
wide.on("name57", a => lines.push("name57: " + describe(a)));
wide.on("name58", a => lines.push("name58: " + describe(a)));
wide.on("name59", a => lines.push("name59: " + describe(a)));
wide.on("name60", a => lines.push("name60: " + describe(a)));
wide.on("name61", a => lines.push("name61: " + describe(a)));
wide.on("name62", a => lines.push("name62: " + describe(a)));
wide.on("name63", a => lines.push("name63: " + describe(a)));
wide.on("name64", a => lines.push("name64: " + describe(a)));
wide.on("name65", a => lines.push("name65: " + describe(a)));
wide.on("name66", a => lines.push("name66: " + describe(a)));
wide.on("name67", a => lines.push("name67: " + describe(a)));
wide.on("name68", a => lines.push("name68: " + describe(a)));
wide.on("name69", a => lines.push("name69: " + describe(a)));
wide.on("name70", a => lines.push("name70: " + describe(a)));
wide.on("name71", a => lines.push("name71: " + describe(a)));
wide.on("name72", a => lines.push("name72: " + describe(a)));
wide.on("name73", a => lines.push("name73: " + describe(a)));
wide.on("name74", a => lines.push("name74: " + describe(a)));
wide.on("name75", a => lines.push("name75: " + describe(a)));
wide.on("name76", a => lines.push("name76: " + describe(a)));
wide.on("name77", a => lines.push("name77: " + describe(a)));
wide.on("name78", a => lines.push("name78: " + describe(a)));
wide.on("name79", a => lines.push("name79: " + describe(a)));
wide.on("name80", a => lines.push("name80: " + describe(a)));
wide.on("name81", a => lines.push("name81: " + describe(a)));
wide.on("name82", a => lines.push("name82: " + describe(a)));
wide.on("name83", a => lines.push("name83: " + describe(a)));
wide.on("name84", a => lines.push("name84: " + describe(a)));
wide.on("name85", a => lines.push("name85: " + describe(a)));
wide.on("name86", a => lines.push("name86: " + describe(a)));
wide.on("name87", a => lines.push("name87: " + describe(a)));
wide.on("name88", a => lines.push("name88: " + describe(a)));
wide.on("name89", a => lines.push("name89: " + describe(a)));
wide.on("name90", a => lines.push("name90: " + describe(a)));
wide.on("name91", a => lines.push("name91: " + describe(a)));
wide.on("name92", a => lines.push("name92: " + describe(a)));
wide.on("name93", a => lines.push("name93: " + describe(a)));
wide.on("name94", a => lines.push("name94: " + describe(a)));
wide.on("name95", a => lines.push("name95: " + describe(a)));
wide.on("name96", a => lines.push("name96: " + describe(a)));
wide.on("name97", a => lines.push("name97: " + describe(a)));
wide.on("name98", a => lines.push("name98: " + describe(a)));
wide.on("name99", a => lines.push("name99: " + describe(a)));
wide.emit("name0", 0);
wide.emit("name1", "text 1");
wide.emit("name2", new Failure(2));
wide.emit("name3", new Request("/3"));
wide.emit("name4", 4);
wide.emit("name5", "text 5");
wide.emit("name6", new Failure(6));
wide.emit("name7", new Request("/7"));
wide.emit("name8", 8);
wide.emit("name9", "text 9");
wide.emit("name10", new Failure(10));
wide.emit("name11", new Request("/11"));
wide.emit("name12", 12);
wide.emit("name13", "text 13");
wide.emit("name14", new Failure(14));
wide.emit("name15", new Request("/15"));
wide.emit("name16", 16);
wide.emit("name17", "text 17");
wide.emit("name18", new Failure(18));
wide.emit("name19", new Request("/19"));
wide.emit("name20", 20);
wide.emit("name21", "text 21");
wide.emit("name22", new Failure(22));
wide.emit("name23", new Request("/23"));
wide.emit("name24", 24);
wide.emit("name25", "text 25");
wide.emit("name26", new Failure(26));
wide.emit("name27", new Request("/27"));
wide.emit("name28", 28);
wide.emit("name29", "text 29");
wide.emit("name30", new Failure(30));
wide.emit("name31", new Request("/31"));
wide.emit("name32", 32);
wide.emit("name33", "text 33");
wide.emit("name34", new Failure(34));
wide.emit("name35", new Request("/35"));
wide.emit("name36", 36);
wide.emit("name37", "text 37");
wide.emit("name38", new Failure(38));
wide.emit("name39", new Request("/39"));
wide.emit("name40", 40);
wide.emit("name41", "text 41");
wide.emit("name42", new Failure(42));
wide.emit("name43", new Request("/43"));
wide.emit("name44", 44);
wide.emit("name45", "text 45");
wide.emit("name46", new Failure(46));
wide.emit("name47", new Request("/47"));
wide.emit("name48", 48);
wide.emit("name49", "text 49");
wide.emit("name50", new Failure(50));
wide.emit("name51", new Request("/51"));
wide.emit("name52", 52);
wide.emit("name53", "text 53");
wide.emit("name54", new Failure(54));
wide.emit("name55", new Request("/55"));
wide.emit("name56", 56);
wide.emit("name57", "text 57");
wide.emit("name58", new Failure(58));
wide.emit("name59", new Request("/59"));
wide.emit("name60", 60);
wide.emit("name61", "text 61");
wide.emit("name62", new Failure(62));
wide.emit("name63", new Request("/63"));
wide.emit("name64", 64);
wide.emit("name65", "text 65");
wide.emit("name66", new Failure(66));
wide.emit("name67", new Request("/67"));
wide.emit("name68", 68);
wide.emit("name69", "text 69");
wide.emit("name70", new Failure(70));
wide.emit("name71", new Request("/71"));
wide.emit("name72", 72);
wide.emit("name73", "text 73");
wide.emit("name74", new Failure(74));
wide.emit("name75", new Request("/75"));
wide.emit("name76", 76);
wide.emit("name77", "text 77");
wide.emit("name78", new Failure(78));
wide.emit("name79", new Request("/79"));
wide.emit("name80", 80);
wide.emit("name81", "text 81");
wide.emit("name82", new Failure(82));
wide.emit("name83", new Request("/83"));
wide.emit("name84", 84);
wide.emit("name85", "text 85");
wide.emit("name86", new Failure(86));
wide.emit("name87", new Request("/87"));
wide.emit("name88", 88);
wide.emit("name89", "text 89");
wide.emit("name90", new Failure(90));
wide.emit("name91", new Request("/91"));
wide.emit("name92", 92);
wide.emit("name93", "text 93");
wide.emit("name94", new Failure(94));
wide.emit("name95", new Request("/95"));
wide.emit("name96", 96);
wide.emit("name97", "text 97");
wide.emit("name98", new Failure(98));
wide.emit("name99", new Request("/99"));
console.log(lines.join("\n"));
