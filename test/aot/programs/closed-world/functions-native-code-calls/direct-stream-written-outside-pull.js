// What a direct stream is sent after pull has returned reaches a waiting reader at the end of the tick, through the tick queue.
const stream = new ReadableStream({
  type: "direct",
  pull(controller) {
    setTimeout(() => {
      controller.write("late");
      setTimeout(() => controller.close(), 5);
    }, 5);
    return new Promise(() => {});
  },
});
const reader = stream.getReader();
reader.read().then(({ value, done }) => console.log(new TextDecoder().decode(value), done));
