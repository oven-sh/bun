// Objects inside objects: repo binds impostors servers and scripts functions bound with arguments are the reactions of a promise inside an async context. It prints what plain Bun prints.
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

function succeeded(id, depth, data) {
  console.log("succeeded", this.name, id, depth, data, storage.getStore());
}
function failed(id, depth, data) {
  console.log("failed", this.name, id, depth, data.message, storage.getStore());
}

function watch(context, depth, id, current) {
  current.then(succeeded.bind(context, id, depth), failed.bind(context, id, depth));
}

const context = { name: "context" };
storage.run("the store", () => {
  watch(context, 1, 2, new Promise(resolve => setTimeout(resolve, 5, "value")));
  watch(context, 3, 4, new Promise((resolve, reject) => setTimeout(reject, 5, new Error("reason"))));
  watch(context, 5, 6, Promise.resolve("at once"));
  watch(context, 7, 8, (async () => "from an async function")());
});
for (let i = 0; i < 200; i++) watch(context, i, i, Promise.resolve(i % 100 === 0 ? "round " + i : new Promise(() => {})));
