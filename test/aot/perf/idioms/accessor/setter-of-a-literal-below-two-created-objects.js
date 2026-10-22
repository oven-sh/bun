import { nextTurns } from "../host.ts";
const answers = {
  get status() {
    return this.code;
  },
  set status(code) {
    this.code = code;
  },
  get length() {
    return this.size;
  },
  set length(size) {
    this.size = size;
  },
};
class Application {
  answers;
  constructor() {
    this.answers = Object.create(answers);
  }
  createAnswer() {
    return Object.create(this.answers);
  }
}
const application = new Application();
function bench(n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const answer = application.createAnswer();
    answer.status = i & 7;
    answer.length = i & 3;
    s += answer.status + answer.length;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
