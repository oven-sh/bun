const { port1, port2 } = new MessageChannel();
port2.onmessage = event => {
  console.log(event.data.size + 1, event.data.list[0].length);
  port1.close();
};
port1.postMessage({ size: 1.5, list: ["two"] });
