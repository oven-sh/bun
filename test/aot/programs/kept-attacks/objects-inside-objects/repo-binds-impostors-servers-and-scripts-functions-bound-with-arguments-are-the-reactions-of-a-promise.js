// Objects inside objects: repo binds impostors servers and scripts functions bound with arguments are the reactions of a promise. It prints what plain Bun prints.
function succeeded(id, depth, data) {
  console.log("succeeded", this.name, id, depth, data);
}
function failed(id, depth, data) {
  console.log("failed", this.name, id, depth, data.message);
}

const context = { name: "context" };
const later = new Promise(resolve => setTimeout(resolve, 5, "value"));
later.then(succeeded.bind(context, 1, 2), failed.bind(context, 1, 2));
const refused = new Promise((resolve, reject) => setTimeout(reject, 5, new Error("reason")));
refused.then(succeeded.bind(context, 3, 4), failed.bind(context, 3, 4));
Promise.resolve("at once").then(succeeded.bind(context, 5, 6), failed.bind(context, 5, 6));
