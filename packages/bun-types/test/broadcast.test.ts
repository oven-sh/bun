const channel = new BroadcastChannel("my-channel");
const message = { hello: "world" };

channel.onmessage = event => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  console.log((event as any).data); // { hello: "world" }
};
channel.postMessage(message);

const error = new Error("hello world");
const clone = structuredClone(error);
console.log(clone.message); // "hello world"
