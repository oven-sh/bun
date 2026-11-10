const cause = { made: "up" };
const first = new DOMException("a", "AbortError");
const second = new DOMException({ toString: () => "b" }, { name: { toString: () => "TimeoutError" }, cause });
const third = new DOMException();
console.log(`${first.name} ${first.code} ${first.message} ${first instanceof Error} ${typeof first.stack}`);
console.log(`${second.name} ${second.code} ${second.message} ${second.cause === cause}`);
console.log(`${third.name} ${third.code} [${third.message}] ${"cause" in third} ${DOMException.ABORT_ERR} ${third.ABORT_ERR}`);
let text = "no refusal";
try {
  DOMException("a");
} catch (error) {
  text = error.name;
}
console.log(`${text}`);
