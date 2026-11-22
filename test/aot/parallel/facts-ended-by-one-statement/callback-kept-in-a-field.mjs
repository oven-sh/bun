class Queue {
  jobs = [];
  last = null;
  runs = 0;
  run(job, times) {
    let sum = 0;
    for (let i = 0; i < times; i++) {
      sum += job(i);
      this.runs++;
    }
    if (times === 3) {
      this.last = job;
      this.jobs.push({ job, times });
    }
    for (let i = 0; i < times; i++) sum = (sum * 7 + i) % 1000;
    return sum;
  }
  again() {
    let text = "";
    for (const { job, times } of this.jobs) text += job(times) + ",";
    return text + (this.last ? this.last(5) : "");
  }
}
const queue = new Queue();
function plan(n) {
  const steps = [];
  let total = n;
  const got = queue.run(i => {
    steps.push(i);
    total += i;
    return total;
  }, n);
  return got + "/" + steps.join("") + "/" + total;
}
let text = "";
for (let i = 1; i < 5; i++) text += plan(i) + " ";
console.log(text);
console.log(queue.again(), plan(3), queue.again(), queue.runs);
