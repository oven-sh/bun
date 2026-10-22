function succeeded(id, depth, data) {
  console.log("succeeded", this.name, id, depth, data);
}
function failed(id, depth, data) {
  console.log("failed", this.name, id, depth, data.message);
}

function watch(context, depth, id, current) {
  if (typeof current === "object" && current !== null && typeof current.then === "function") {
    current.then(succeeded.bind(context, id, depth), failed.bind(context, id, depth));
    return "watched";
  }
  return typeof current;
}

const context = { name: "context" };
const values = JSON.parse('[1, "two", null, {"then": 3}]');
values.push(
  new Promise(resolve => setTimeout(resolve, 5, "value")),
  new Promise((resolve, reject) => setTimeout(reject, 5, new Error("reason"))),
  Promise.resolve("at once"),
  (async () => "from an async function")(),
  { then: (resolve, reject) => resolve("from a thenable") },
);
values.forEach((value, index) => console.log(index, watch(context, index * 10, index, value)));
