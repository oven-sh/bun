const kept = new CustomEvent("a", { get detail() { return new Map([[1, new URL("http://localhost/b")]]); } });
console.log(`${kept.detail.get(1).pathname} ${kept.detail.size}`);
const above = new CustomEvent("a", Object.create({ detail: [1, 2, 3], bubbles: { valueOf() { throw new Error("never asked"); } } }));
console.log(`${above.detail.length} ${above.detail.at(-1)} ${above.bubbles}`);
const failed = new ErrorEvent("a", { message: { toString() { return new URL("http://localhost/said").pathname; } }, lineno: { valueOf() { return new TextEncoder().encode("abc").length; } } });
console.log(`${failed.message} ${failed.lineno} ${failed.colno}`);
const again = new CustomEvent({ toString() { return btoa("a"); } });
again.initCustomEvent({ toString() { return atob("YQ=="); } }, 1, 0, new Set([new Date(0)]));
console.log(`${again.type} ${[...again.detail][0].toISOString()} ${again.bubbles} ${again.cancelable}`);
