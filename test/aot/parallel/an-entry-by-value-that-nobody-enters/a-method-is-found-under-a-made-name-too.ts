// A method whose written call is copied is also found under a name that is made at run time, and on an object that has left.
class Worker {
  readonly pay: number;
  constructor(pay: number) {
    this.pay = pay;
  }
  raise(by: number): number {
    return this.pay + by;
  }
}
const worker = new Worker(10);
console.log(worker.raise(1));
const text = JSON.stringify(Object.getOwnPropertyNames(Worker.prototype));
const found: any = (Worker.prototype as any)[JSON.parse(text)[1]];
console.log(text, found.call(worker, 2), Object.entries(Object.getOwnPropertyDescriptors(Worker.prototype)).map(([key, d]) => key + typeof d.value).join());
(globalThis as any).kept = worker;
console.log((globalThis as any).kept.raise(3), eval("1 + 1"));
