import { createHistogram } from "node:perf_hooks";
const h = createHistogram();
h.record(7);
const { port1, port2 } = new MessageChannel();
port2.onmessage = event => {
  console.log(event.data.min, event.data.max, event.data);
  port1.close();
  port2.close();
};
port1.postMessage(h);
