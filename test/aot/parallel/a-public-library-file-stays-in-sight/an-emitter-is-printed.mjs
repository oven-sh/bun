import EventEmitter from "node:events";
class A extends EventEmitter {}
console.log(new A()); console.log(new EventEmitter());
