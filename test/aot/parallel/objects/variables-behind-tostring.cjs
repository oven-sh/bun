// F.prototype.toString = closure runs no code, so variables that are stored behind it stay constants.
function Task(kind) { this.kind = kind; this.state = IDLE; this.size = SIZE; }
Task.prototype.run = function () { this.state = this.state | RUNNING; return this.size * SCALE + this.state; };
Task.prototype.toString = function () { return "Task " + this.kind + " " + SCALE; };
Task.prototype.valueOf = function () { return this.run() + LAST; };
Task.prototype.toLocaleString = function () { return this.toString() + "!"; };
Task.prototype.hasOwnProperty = function (name) { return name === KEY; };
var IDLE = 0, RUNNING = 4, SIZE = 4;
var SCALE = 10;
var KEY = "state";
function Early() { this.seen = LATE; }
Early.prototype.toString = function () { return "Early " + this.seen + " " + LATE; };
console.log(String(new Early()));
var LATE = 7;
console.log(String(new Early()));
var LAST = 1000;
const task = new Task("worker");
console.log(task.run(), String(task), task + 1, task.toLocaleString(), task.hasOwnProperty("state"), task.hasOwnProperty("kind"));
console.log(task.state, task.size, Object.keys(Task.prototype).join());
