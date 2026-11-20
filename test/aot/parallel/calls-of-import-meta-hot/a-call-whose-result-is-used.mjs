const answer = import.meta.hot.accept(() => {});
const list = [import.meta.hot.dispose(() => {}), import.meta.hot.on("event", () => {})];
console.log(answer, list.length, list[0], list[1], import.meta.hot.send("event", 1) ?? "nothing");
