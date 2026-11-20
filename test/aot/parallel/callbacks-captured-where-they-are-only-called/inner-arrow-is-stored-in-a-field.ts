class Task {
    run: (() => number) | undefined = undefined;
    again: (() => number) | undefined = undefined;
    constructor(public id: number) {}
}

function arm(task: Task, f: () => number): number {
    task.run = () => f() + task.id;
    task.again = task.run;
    return 1;
}

function armByCall(task: Task, f: () => number): number {
    const t = install(task, () => f() - task.id);
    return t + 1;
}

function install(task: Task, job: () => number): number {
    task.run = job;
    task.again = job;
    return task.id;
}

function maker(task: Task, k: number): number {
    const t = task.id % 2 ? arm(task, () => k * 100) : armByCall(task, () => k * 100);
    return t;
}

function twice(f: (x: number) => number): number {
    const t = f(1) + f(2);
    return t;
}

function overwriteStack(depth: number, salt: number): number {
    if (!depth) return salt;
    const a = twice(x => x - depth + salt);
    const b = overwriteStack(depth - 1, salt + 2);
    return (a + b) % 1000003;
}

const tasks: Task[] = [];
let answers = 0;
for (let i = 0; i < 300; i++) {
    const task = new Task(i);
    answers += maker(task, i + 1);
    tasks.push(task);
}
Bun.gc(true);
console.log(overwriteStack(1500, 11));
Bun.gc(true);

let sum = 0;
let same = 0;
const jobs = new Set<() => number>();
for (const task of tasks) {
    sum += task.run!() + task.again!();
    same += task.run === task.again ? 1 : 0;
    jobs.add(task.run!);
    jobs.add(task.again!);
}
console.log(answers, sum, same, jobs.size);
console.log(tasks[0].run!(), tasks[1].run!(), tasks[298].again!(), tasks[299].again!());
