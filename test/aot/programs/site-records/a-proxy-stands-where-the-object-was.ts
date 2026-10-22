// A Proxy arrives where reads, stores and method calls expect an object of a layout, or stands above such an object in its chain. Every trap runs, with the right target, key and receiver.
class Job {
  title = "job";
  priority = 1;
  run(by: number): number {
    return this.priority * by;
  }
}

const trail: string[] = [];

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function titleOf(job: Job): string {
  return job.title;
}
function priorityOf(job: Job): number {
  return job.priority;
}
function raise(job: Job, to: number): void {
  job.priority = to;
}
function runIt(job: Job): number {
  return job.run(3);
}
function hasTitle(job: Job): boolean {
  return "title" in job;
}
function look(mark: string, job: Job): void {
  console.log(mark + ":", attempt(() => titleOf(job)), attempt(() => priorityOf(job)), attempt(() => raise(job, 5)), attempt(() => priorityOf(job)), attempt(() => runIt(job)), attempt(() => hasTitle(job)));
  console.log("  " + trail.splice(0).join(" "));
}

function watched(target: object, name: string): any {
  const proxy: any = new Proxy(target, {
    get(inner, key, receiver) {
      trail.push(name + ".get(" + String(key) + "," + (receiver === proxy ? "proxy" : "other") + ")");
      return Reflect.get(inner, key, receiver);
    },
    set(inner, key, value, receiver) {
      trail.push(name + ".set(" + String(key) + "," + String(value) + "," + (receiver === proxy ? "proxy" : "other") + ")");
      return Reflect.set(inner, key, value, receiver);
    },
    has(inner, key) {
      trail.push(name + ".has(" + String(key) + ")");
      return Reflect.has(inner, key);
    },
    getOwnPropertyDescriptor(inner, key) {
      trail.push(name + ".describe(" + String(key) + ")");
      return Reflect.getOwnPropertyDescriptor(inner, key);
    },
    defineProperty(inner, key, descriptor) {
      trail.push(name + ".define(" + String(key) + ")");
      return Reflect.defineProperty(inner, key, descriptor);
    },
  });
  return proxy;
}

const honest = new Job();
look("honest", honest);
look("watched", watched(new Job(), "w"));
look("honest", honest);
look("without traps", new Proxy(new Job(), {}));
look("around a literal", watched({ priority: 2, title: "literal", run: (by: number) => by }, "l"));
look("around a proxy", watched(watched(new Job(), "inner"), "outer"));

const liar: any = new Proxy(new Job(), {
  get(_inner, key) {
    return key === "title" ? 404 : key === "priority" ? "high" : undefined;
  },
  set() {
    return false;
  },
  has() {
    return false;
  },
});
look("a proxy that lies", liar);

const revocable = Proxy.revocable(new Job(), {});
look("before it is revoked", revocable.proxy);
revocable.revoke();
look("revoked", revocable.proxy);

const below = new Job();
Object.setPrototypeOf(below, watched(Job.prototype, "above"));
look("a proxy above, fields present", below);
delete (below as any).title;
delete (below as any).priority;
look("a proxy above, fields deleted", below);
look("a proxy above, after the store", below);
look("honest", honest);

export {};
