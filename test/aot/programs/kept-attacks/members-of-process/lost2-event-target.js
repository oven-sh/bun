// Members of process: lost2 event target. It prints what plain Bun prints.
const self = await new Promise(resolve => { const t = new EventTarget(); t.addEventListener("e", e => resolve(e.detail)); t.dispatchEvent(new CustomEvent("e", { detail: process })); });
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
