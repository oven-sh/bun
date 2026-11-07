import { test } from "bun:test";
const unseen = (x) => [x][JSON.parse("0")];
function read(key) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const box = { name: "text", size: 1 }; const seen = box[key]; return typeof box.name; }
function store(key) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const box = { name: "text", size: 1 }; box[key] = 1; return typeof box.name; }
function named() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const box = { name: "text", size: 1 }; const seen = box.late; return typeof box.name; }
function namedStore() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const box = { name: "text", size: 1 }; box.late = 1; return typeof box.name; }
function sum(key) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const box = { a: 1, b: 2 }; const seen = box[key]; return box.a + box.b; }
test("an accessor above stores into what it is handed", () => {
  Object.defineProperty(Object.prototype, "late", { get() { this.name = 7; this.a = "x"; return 1; }, set(value) { this.name = 7; this.a = "x"; }, configurable: true });
  const key = unseen("late");
  let out = [];
  try { for (let i = 0; i < 300; i++) out = [read(key), store(key), named(), namedStore(), sum(key)]; } finally { delete Object.prototype.late; }
  console.log(out.join());
});
