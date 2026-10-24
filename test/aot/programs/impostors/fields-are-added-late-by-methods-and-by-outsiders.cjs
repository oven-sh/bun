function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function Job(title) {
  this.title = title;
}
Job.prototype.start = function (when) {
  this.startedAt = when;
  return this;
};
Job.prototype.finish = function (when) {
  this.finishedAt = when;
  return this;
};
Job.prototype.duration = function () {
  return this.finishedAt - this.startedAt;
};
Job.prototype.state = function () {
  if (this.finishedAt !== undefined) return "finished";
  if ("startedAt" in this) return "started";
  return "new";
};

function durationOf(job) {
  return job.duration();
}

function stateOf(job) {
  return job.state();
}

function startedAtOf(job) {
  return job.startedAt;
}

function look(label, job) {
  console.log(label + ": " + show(job) + " | state " + stateOf(job) + " | startedAt " + show(startedAtOf(job)) + " | duration " + show(durationOf(job)) + " | owns startedAt " + Object.hasOwn(job, "startedAt"));
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += durationOf(new Job("honest").start(i).finish(i + 3));
console.log("2000 jobs started and finished", sum);

look("never started", new Job("a"));
look("started", new Job("b").start(1));
look("finished without a start", new Job("c").finish(9));
look("finished, then started", new Job("d").finish(9).start(1));
look("started twice", new Job("e").start(1).start(2).finish(5));

const outsider = new Job("f");
outsider.finishedAt = 10;
outsider.owner = "outsider";
outsider.startedAt = 4;
look("an outsider stored the fields and one more", outsider);

const computed = new Job("g");
for (const name of ["finished", "started"]) computed[name + "At"] = name.length;
look("stored under computed names", computed);

const hidden = new Job("h");
Object.assign(hidden, JSON.parse('{"startedAt":"2","finishedAt":"12"}'));
look("strings were copied in from parsed JSON", hidden);

const defined = new Job("i");
Object.defineProperty(defined, "startedAt", { get() { return 100; }, enumerable: true, configurable: true });
defined.finish(150);
look("startedAt is a getter", defined);
try {
  defined.start(1);
  look("a sloppy store to the getter is dropped", defined);
} catch (error) {
  console.log("a store to the getter threw " + error.constructor.name);
}

const closed = Object.preventExtensions(new Job("j"));
closed.start(1).finish(2);
look("not extensible, so nothing is added", closed);

const removed = new Job("k").start(1).finish(2);
delete removed.startedAt;
look("startedAt deleted", removed);
removed.start(0);
look("and started again", removed);

Job.prototype.startedAt = 1000;
look("the prototype now has startedAt, never started", new Job("l"));
look("the prototype now has startedAt, finished only", new Job("m").finish(1500));
look("the prototype now has startedAt, started", new Job("n").start(1).finish(2));
delete Job.prototype.startedAt;
look("the prototype lost it again", new Job("o").finish(1500));

sum = 0;
for (let i = 0; i < 2000; i++) sum += durationOf(new Job("honest").start(i).finish(i + 3));
console.log("2000 honest jobs again", sum);
