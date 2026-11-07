const { port1, port2 } = new MessageChannel();
port1.tag = "as made";
port1.onmessage = function (event) {
  this.tag = "by this: " + event.data;
  event.target.more = event.target === port1;
  console.log(port1.tag, port1.more);
  port1.close();
  port2.close();
};
port2.postMessage("sent");
