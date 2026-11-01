declare var self: Worker;
const list: number[] = [1, 2, 3];
self.onmessage = event => {
  self.postMessage("w6 got " + event.data + " " + list.map(x => x * 2).join());
};
