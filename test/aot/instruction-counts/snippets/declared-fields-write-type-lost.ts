// replaces the values of four declared fields of a class instance through a parameter of type any
class Message {
  url = "/";
  status = 200;
  sent = false;
  next: Message | null = null;
}
const operations = 100;
const messages: any[] = [];
for (let i = 0; i < operations; i++) messages.push(new Message());
const write = (message: any, url: any, status: any, sent: any, next: any) => {
  message.url = url;
  message.status = status;
  message.sent = sent;
  message.next = next;
};

kernel: {
  for (let i = 0; i < messages.length; i++) write(messages[i], "/a", 404, true, messages[0]);
}

console.log(messages[7].url, messages[7].status, messages[7].sent, messages[7].next === messages[0]);
